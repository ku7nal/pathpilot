import assert from "node:assert/strict";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, test } from "node:test";
import { createServer } from "../server.mjs";

const realFetch = globalThis.fetch;
const originalApiKey = process.env.TINYFISH_API_KEY;
let server;

afterEach(async () => {
  globalThis.fetch = realFetch;
  if (originalApiKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalApiKey;
  server = undefined;
});

class CaptureResponse extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.headers = {};
    this.headersSent = false;
  }
  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  get body() { return Buffer.concat(this.chunks).toString(); }
}

async function request(server, method, url, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost" };
  const res = new CaptureResponse();
  server.emit("request", req, res);
  await once(res, "finish");
  return res;
}

function newServer() {
  server = createServer();
  return server;
}

function lastEvent(body, eventName) {
  const block = body.split(/\r?\n\r?\n/).findLast((item) => item.startsWith(`event: ${eventName}\n`));
  return JSON.parse(block.split("\n").find((line) => line.startsWith("data:")).slice(5));
}

test("job scout returns the inferred target and source-backed requirements", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const agentCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      return Response.json({
        results: [
          { title: "AI Engineer", url: "https://boards.greenhouse.io/acme/jobs/1", site_name: "Greenhouse" },
          { title: "ML Engineer", url: "https://jobs.lever.co/bright/2", site_name: "Lever" },
          { title: "AI Engineer", url: "https://jobs.ashbyhq.com/closed/3", site_name: "Ashby" },
        ],
      });
    }

    assert.equal(url.pathname, "/v1/automation/run-sse");
    agentCalls.push(JSON.parse(init.body));
    const index = agentCalls.length;
    if (index === 3) return new Response("Listing blocked", { status: 403 });
    const jobs = index === 1
      ? [{ title: "AI Engineer", company: "Acme", location: "Remote", experience: "2+ years", skills: ["Python", "SQL"], application_url: "https://boards.greenhouse.io/acme/jobs/1", is_open: true }]
      : [{ title: "ML Engineer", company: "Bright", location: "Remote", experience: "3+ years", skills: ["Python", "PyTorch"], application_url: "https://jobs.lever.co/bright/2", is_open: true }];
    const payload = `data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: { jobs } })}\n\n`;
    const split = Math.floor(payload.length / 2);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, split)));
        controller.enqueue(new TextEncoder().encode(payload.slice(split)));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };

  const response = await request(newServer(), "POST", "/api/job-scout", { goal: "I want to become an AI engineer" });
  const body = response.body;

  assert.equal(response.statusCode, 200);
  assert.match(body, /"targetRole":"AI Engineer"/);
  assert.match(body, /"company":"Acme"/);
  assert.match(body, /"company":"Bright"/);
  assert.match(body, /"name":"Python","count":2/);
  assert.equal(agentCalls.length, 3);
  assert.ok(agentCalls.every((call) => call.output_schema && call.goal));
  assert.match(body, /"inaccessibleSources":1/);
});

test("broad learning goals show a sparse result when search finds no sources", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  globalThis.fetch = async () => Response.json({ results: [] });

  const response = await request(newServer(), "POST", "/api/job-scout", { goal: "I want to learn programming" });
  const events = response.body.split(/\r?\n\r?\n/).filter(Boolean);
  const complete = JSON.parse(events.at(-1).split("\n").find((line) => line.startsWith("data:")).slice(5));

  assert.equal(response.statusCode, 200);
  assert.equal(complete.targetRole, "Programming");
  assert.equal(complete.sourceCount, 0);
  assert.deepEqual(complete.jobs, []);
  assert.match(complete.message, /No matching job sources/);
});

test("job scout asks for an API key instead of presenting invented live results", async () => {
  delete process.env.TINYFISH_API_KEY;
  const response = await request(newServer(), "POST", "/api/job-scout", { goal: "I want to learn backend development" });

  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body).error, /TINYFISH_API_KEY/);
});

test("learning roadmap uses scout skills and returns a sequenced source-linked plan", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const agentCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      const query = url.searchParams.get("query");
      const result = query.includes("site:roadmap.sh")
        ? { title: "Frontend Roadmap", url: "https://roadmap.sh/frontend", site_name: "roadmap.sh" }
        : query.includes("site:codedex.io")
          ? { title: "Learn JavaScript", url: "https://www.codedex.io/javascript", site_name: "Codédex" }
          : { title: "HTML Documentation", url: "https://developer.mozilla.org/en-US/docs/Learn/HTML", site_name: "MDN" };
      return Response.json({ results: [result] });
    }

    assert.equal(url.pathname, "/v1/automation/run-sse");
    const body = JSON.parse(init.body);
    agentCalls.push(body);
    const phases = [
      {
        order: 1,
        title: "Web foundations",
        focus: "Build semantic pages and style them accessibly.",
        progression: "HTML and CSS provide the structure for interactive frontend work.",
        estimated_hours: 8,
        job_relevance: "HTML and CSS appear in the target roles.",
        skills: ["HTML", "CSS"],
        resources: [
          { title: "HTML Tutorial", url: "https://developer.mozilla.org/en-US/docs/Learn/HTML", provider: "MDN", reason: "Official introduction to HTML.", related_skills: ["HTML"] },
          { title: "Unsafe", url: "javascript:alert(1)", provider: "Unknown", reason: "Bad URL", related_skills: ["HTML"] },
          { title: "Unverified", url: "https://random.example/course", provider: "Unknown", reason: "Not a searched source", related_skills: ["HTML"] },
          { title: "Weak match", url: "https://developer.mozilla.org/en-US/docs/Learn/Rust", provider: "MDN", reason: "Does not match employer skills.", related_skills: ["Rust"] },
        ],
      },
      {
        order: 2,
        title: "Interactive interfaces",
        focus: "Build interactive browser features.",
        progression: "Use the fundamentals to add behavior and connect components.",
        estimated_hours: 12,
        job_relevance: "JavaScript is a recurring employer requirement.",
        skills: ["JavaScript"],
        resources: [
          { title: "JavaScript Basics", url: "https://www.codedex.io/javascript", provider: "Codédex", reason: "Practice JavaScript fundamentals.", related_skills: ["JavaScript"] },
          { title: "Duplicate", url: "https://developer.mozilla.org/en-US/docs/Learn/HTML#duplicate", provider: "MDN", reason: "Duplicate source URL.", related_skills: ["HTML"] },
        ],
      },
    ];
    const payload = `data: ${JSON.stringify({
      type: "COMPLETE",
      status: "COMPLETED",
      result: {
        inspected_urls: ["https://roadmap.sh/frontend", "https://www.codedex.io/javascript", "https://developer.mozilla.org/en-US/docs/Learn/HTML"],
        inaccessible_urls: [],
        phases,
      },
    })}\n\n`;
    return new Response(payload, { headers: { "Content-Type": "text/event-stream" } });
  };

  const response = await request(newServer(), "POST", "/api/learning-roadmap", {
    goal: "I want to become a frontend developer",
    targetRole: "Frontend Developer",
    skills: ["JavaScript", "HTML", "CSS"],
    jobs: [{ title: "Frontend Engineer", skills: ["JavaScript", "HTML", "CSS"], experience: "Entry level" }],
  });
  const complete = lastEvent(response.body, "complete");

  assert.equal(response.statusCode, 200);
  assert.equal(agentCalls.length, 1);
  assert.match(agentCalls[0].goal, /JavaScript/);
  assert.ok(agentCalls[0].output_schema);
  assert.equal(complete.targetRole, "Frontend Developer");
  assert.deepEqual(complete.checkedSources, ["roadmap.sh", "Codédex", "official documentation"]);
  assert.deepEqual(complete.phases.map((phase) => phase.order), [1, 2]);
  assert.equal(complete.phases[0].resources.length, 1);
  assert.equal(complete.phases[1].resources.length, 1);
  assert.equal(complete.inaccessibleSources.length, 0);
});

test("learning roadmap reports sparse and inaccessible curated searches", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  let agentCalled = false;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      if (url.searchParams.get("query").includes("site:roadmap.sh")) return new Response("Search unavailable", { status: 503 });
      return Response.json({ results: [] });
    }
    agentCalled = true;
    throw new Error("Agent should not run without candidate pages");
  };

  const response = await request(newServer(), "POST", "/api/learning-roadmap", {
    goal: "I want to learn programming",
    targetRole: "Programming",
    skills: [],
    jobs: [],
  });
  const complete = lastEvent(response.body, "complete");

  assert.equal(response.statusCode, 200);
  assert.equal(agentCalled, false);
  assert.deepEqual(complete.phases, []);
  assert.deepEqual(complete.sparseSources, ["Codédex", "official documentation"]);
  assert.deepEqual(complete.inaccessibleSources, ["roadmap.sh"]);
  assert.match(complete.message, /No learning resources could be verified/);
});

test("learning roadmap validates scout input and does not expose results without an API key", async () => {
  delete process.env.TINYFISH_API_KEY;
  const nonObject = await request(newServer(), "POST", "/api/learning-roadmap", null);
  assert.equal(nonObject.statusCode, 400);

  const invalid = await request(newServer(), "POST", "/api/learning-roadmap", {
    goal: "I want to learn programming",
    targetRole: "Programming",
    skills: "not-an-array",
    jobs: [],
  });
  assert.equal(invalid.statusCode, 400);

  const response = await request(newServer(), "POST", "/api/learning-roadmap", {
    goal: "I want to learn programming",
    targetRole: "Programming",
    skills: [],
    jobs: [],
  });

  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body).error, /TINYFISH_API_KEY/);
});
