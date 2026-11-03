import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST, runtime, maxDuration } from "../app/api/job-scout/route.js";

const realFetch = globalThis.fetch;
const originalApiKey = process.env.TINYFISH_API_KEY;

test("job scout uses a Node.js streaming route with the production duration", () => {
  assert.equal(runtime, "nodejs");
  assert.equal(maxDuration, 360);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalApiKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalApiKey;
});

function events(body) {
  return body.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const name = block.match(/^event: (.+)$/m)?.[1];
    const data = block.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5);
    return { name, data: data ? JSON.parse(data) : null };
  });
}

function post(body, getUserId = async () => "test-user", billing = async () => ({ claimed: true })) {
  return POST(new Request("http://localhost/api/job-scout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, reservationId: "test-reservation" }),
  }), {}, getUserId, billing, async () => "test-token");
}

test("job scout streams verified, source-linked roles for the inferred target", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const agentCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get("X-API-Key"), "test-key");
    if (url.hostname === "api.search.tinyfish.ai") {
      return Response.json({ results: [
        { title: "Acme careers", url: "https://boards.greenhouse.io/acme/jobs/1", site_name: "Greenhouse" },
        { title: "Bright careers", url: "https://jobs.lever.co/bright/2", site_name: "Lever" },
        { title: "Contoso careers", url: "https://jobs.ashbyhq.com/contoso/3", site_name: "Ashby" },
        { title: "Untrusted result", url: "https://example.com/job", site_name: "Example" },
      ] });
    }

    assert.equal(url.hostname, "agent.tinyfish.ai");
    agentCalls.push(JSON.parse(init.body));
    const index = agentCalls.length;
    if (index === 3) return new Response("Agent unavailable", { status: 503 });
    const company = index === 1 ? "Acme" : "Bright";
    const page = index === 1 ? "https://boards.greenhouse.io/acme/jobs/1" : "https://jobs.lever.co/bright/2";
    const applicationPage = index === 1 ? "https://boards.greenhouse.io/acme/jobs/3" : "https://jobs.lever.co/bright/4";
    return new Response(`data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: { jobs: [
      { title: "AI Engineer", company, location: "Remote", experience: "2+ years", skills: ["Python", "SQL"], application_url: applicationPage, is_open: true },
      { title: "Closed role", company, skills: ["Python"], application_url: page, is_open: false },
      { title: "Unverified role", company, skills: ["Invented skill"], application_url: "https://example.com/fake", is_open: true },
    ] } })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };

  const response = await post({ goal: "I want to become an AI engineer" });
  const responseEvents = events(await response.text());
  const complete = responseEvents.find((event) => event.name === "complete").data;

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.ok(responseEvents.some((event) => event.name === "status"));
  assert.equal(complete.targetRole, "AI Engineer");
  assert.deepEqual(complete.jobs.map((job) => job.company), ["Acme", "Bright"]);
  assert.equal(complete.jobs[0].sourceUrl, "https://boards.greenhouse.io/acme/jobs/1");
  assert.equal(complete.jobs[0].url, "https://boards.greenhouse.io/acme/jobs/3");
  assert.deepEqual(complete.skills, [{ name: "Python", count: 2 }, { name: "SQL", count: 2 }]);
  assert.equal(complete.sourceCount, 3);
  assert.equal(complete.inaccessibleSources, 0);
  assert.equal(complete.uncertainSources, 1);
  assert.equal(agentCalls.length, 3);
  assert.ok(agentCalls.every((call) => call.output_schema && call.goal.includes("AI Engineer")));
});

test("job scout rejects invalid goals before calling TinyFish", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  globalThis.fetch = async () => assert.fail("TinyFish should not be called for an invalid goal");

  const response = await post({ goal: "x" }, async () => "test-user", async () => assert.fail("Invalid goals must not claim quota"));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /3 and 240/);
});

test("job scout rejects oversized requests before calling TinyFish", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  globalThis.fetch = async () => assert.fail("TinyFish should not be called for an oversized request");

  const response = await post({ goal: "x".repeat(8_000) });

  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/);
});

test("job scout reports missing TinyFish credentials without inventing results", async () => {
  delete process.env.TINYFISH_API_KEY;
  globalThis.fetch = async () => assert.fail("TinyFish should not be called without credentials");

  const response = await post({ goal: "I want to become an AI engineer" });

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TINYFISH_API_KEY/);
});

test("job scout rejects unauthenticated requests", async () => {
  const response = await POST(new Request("http://localhost/api/job-scout", { method: "POST", body: "{}" }), {}, async () => null);
  assert.equal(response.status, 401);
});
