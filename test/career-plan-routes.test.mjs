import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST } from "../app/api/[workflow]/route.js";

const realFetch = globalThis.fetch;
const originalApiKey = process.env.TINYFISH_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalApiKey === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = originalApiKey;
});

function readEvents(body) {
  return body.split(/\r?\n\r?\n/).filter(Boolean).map((block) => ({
    name: block.match(/^event: (.+)$/m)?.[1],
    data: JSON.parse(block.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5)),
  }));
}

async function post(workflow, body) {
  return POST(new Request(`http://localhost/api/${workflow}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ workflow }) });
}

test("Next roadmap route uses job signals and returns inspected resources and coverage", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const pages = [
    { title: "Roadmap", url: "https://roadmap.sh/frontend", site_name: "roadmap.sh" },
    { title: "JavaScript", url: "https://www.codedex.io/javascript", site_name: "Codédex" },
    { title: "MDN HTML", url: "https://developer.mozilla.org/en-US/docs/Learn/HTML", site_name: "MDN" },
  ];
  let agentBody;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      if (url.searchParams.get("query").includes("site:roadmap.sh")) return Response.json({ results: [pages[0]] });
      if (url.searchParams.get("query").includes("site:codedex.io")) return Response.json({ results: [pages[1]] });
      return new Response("unavailable", { status: 503 });
    }
    if (url.hostname === "api.fetch.tinyfish.ai") return Response.json({ results: pages.slice(0, 2).map((page) => ({ url: page.url, text: "JavaScript HTML CSS tutorial" })) });
    agentBody = JSON.parse(init.body);
    return new Response(`data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: {
      inspected_urls: pages.slice(0, 2).map((page) => page.url),
      inaccessible_urls: [],
      phases: [{ title: "Web foundations", focus: "Build pages", progression: "Start with structure", estimated_hours: 8, skills: ["HTML"], resources: [
        { title: "HTML guide", url: pages[0].url, provider: "Roadmap", reason: "Learn HTML", related_skills: ["HTML"] },
        { title: "Uninspected page", url: pages[2].url, provider: "MDN", reason: "Not inspected", related_skills: ["HTML"] },
      ] }],
    } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };

  const response = await post("learning-roadmap", {
    goal: "I want to become a frontend developer",
    targetRole: "Frontend Developer",
    skills: ["JavaScript", "HTML", "CSS"],
    jobs: [{ title: "Frontend Engineer", skills: ["JavaScript", "HTML"], experience: "Entry level" }],
  });
  const responseEvents = readEvents(await response.text());
  const complete = responseEvents.find((event) => event.name === "complete").data;

  assert.equal(response.status, 200);
  assert.ok(responseEvents.some((event) => event.name === "status"));
  assert.match(agentBody.goal, /Frontend Engineer/);
  assert.match(agentBody.goal, /JavaScript/);
  assert.deepEqual(complete.checkedSources, ["roadmap.sh", "Codédex"]);
  assert.deepEqual(complete.inaccessibleSources, ["official documentation"]);
  assert.equal(complete.phases[0].resources.length, 1);
  assert.equal(complete.phases[0].resources[0].url, pages[0].url);
});

test("Next project route returns recommendations only with inspected practitioner evidence", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const pages = ["https://github.com/example/one", "https://example.dev/two"];
  const unreportedPage = "https://portfolio.example/three";
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") return Response.json({ results: [...pages, unreportedPage].map((page) => ({ title: page, url: page })) });
    if (url.hostname === "api.fetch.tinyfish.ai") return Response.json({ results: [...pages, unreportedPage].map((page) => ({ url: page, text: "Python and model API" })) });
    const payload = JSON.parse(init.body);
    assert.match(payload.goal, /Python/);
    return new Response(`data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: {
      inspected_urls: pages,
      inaccessible_urls: [],
      practitioners: [
        { name: "Ada Dev", role: "ML Engineer", profile_url: pages[0], demonstrated_skills: ["Python"], work_summary: "Built an API" },
        { name: "Lin Eng", role: "AI Engineer", profile_url: pages[1], demonstrated_skills: ["FastAPI"], work_summary: "Published a project" },
        { name: "Invented", role: "Engineer", profile_url: "https://other.example/person", demonstrated_skills: [], work_summary: "Not inspected" },
      ],
      projects: [{ title: "Model API", difficulty: "Starter", prerequisites: ["Python"], rationale: "Evidence-backed patterns", portfolio_value: "Deployment sample", roadmap_phase: "API foundations", skills: ["Python"], practitioner_names: ["Ada Dev", "Lin Eng", "Invented"], milestones: ["Create API", "Add tests"], source_urls: [...pages, "https://other.example/evidence"] }],
    } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };

  const response = await post("project-scout", { goal: "I want to become an AI engineer", skills: ["Python"] });
  const responseEvents = readEvents(await response.text());
  const complete = responseEvents.find((event) => event.name === "complete").data;

  assert.equal(response.status, 200);
  assert.ok(responseEvents.some((event) => event.name === "progress"));
  assert.equal(complete.practitioners.length, 2);
  assert.equal(complete.projects.length, 1);
  assert.deepEqual(complete.projects[0].practitioners, ["Ada Dev", "Lin Eng"]);
  assert.deepEqual(complete.projects[0].sources.map((source) => source.url), pages);
  assert.deepEqual(complete.checkedSources.map((source) => source.url), pages);
  assert.deepEqual(complete.uncertainSources, ["portfolio.example"]);
});

test("Next opportunity route includes only future dates quoted in fetched official pages", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const page = "https://events.example.org/ai-sprint";
  const unreportedPage = "https://another.events/future";
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      assert.ok(url.searchParams.has("after_date"));
      return Response.json({ results: [{ title: "Official AI Sprint", url: page, site_name: "Event Org" }, { title: "Other event", url: unreportedPage }] });
    }
    if (url.hostname === "api.fetch.tinyfish.ai") return Response.json({ results: [{ url: page, text: "Applications close on 2030-10-12. Open to students." }, { url: unreportedPage, text: "Future event" }] });
    return new Response(`data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: {
      inspected_urls: [page], inaccessible_urls: [], opportunities: [
        { title: "AI Sprint", type: "Hackathon", summary: "Build an AI project", date: "2030-10-12", date_label: "Application deadline", date_evidence: "Applications close on 2030-10-12", eligibility: "Students", location: "Online", source_url: page, source_is_official: true, application_url: page },
        { title: "Unverified date", type: "Event", summary: "No date quote", date: "2030-10-13", date_label: "Event date", date_evidence: "October 13", eligibility: "Open", location: "Online", source_url: page, source_is_official: true, application_url: page },
        { title: "Unverified application", type: "Event", summary: "Application URL is absent from the page", date: "2030-10-14", date_label: "Application deadline", date_evidence: "Applications close on 2030-10-12", eligibility: "Students", location: "Online", source_url: page, source_is_official: true, application_url: "https://fake.example/apply" },
      ],
    } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };

  const response = await post("opportunity-scout", { goal: "I want to become an AI engineer", skills: ["Python"] });
  const responseEvents = readEvents(await response.text());
  const complete = responseEvents.find((event) => event.name === "complete").data;

  assert.equal(response.status, 200);
  assert.ok(responseEvents.some((event) => event.name === "progress"));
  assert.equal(complete.opportunities.length, 1);
  assert.equal(complete.opportunities[0].sourceUrl, page);
  assert.deepEqual(complete.checkedSources.map((source) => source.url), [page]);
  assert.deepEqual(complete.uncertainSources, ["another.events"]);
});

test("Next career routes report Agent failures as uncertain source coverage", async () => {
  process.env.TINYFISH_API_KEY = "test-key";
  const page = "https://roadmap.sh/frontend";
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.search.tinyfish.ai") {
      const query = url.searchParams.get("query");
      if (query.includes("site:roadmap.sh")) return Response.json({ results: [{ title: "Roadmap", url: page, site_name: "roadmap.sh" }] });
      if (query.includes("site:codedex.io")) return Response.json({ results: [] });
      if (query.includes("official documentation")) return Response.json({ results: [] });
      if (url.searchParams.has("after_date")) return Response.json({ results: [{ title: "Candidate", url: "https://events.example.org/event", site_name: "events.example.org" }] });
      return Response.json({ results: [{ title: "Candidate", url: "https://portfolio.example/work", site_name: "portfolio.example" }] });
    }
    if (url.hostname === "api.fetch.tinyfish.ai") return Response.json({ results: [{ url: page, text: "Learning resources" }, { url: "https://portfolio.example/work", text: "Practitioner work" }, { url: "https://events.example.org/event", text: "Official event" }] });
    return new Response("Agent unavailable", { status: 503 });
  };
  const cases = [
    ["learning-roadmap", { goal: "I want to become a frontend developer", targetRole: "Frontend Developer", skills: ["JavaScript"], jobs: [] }, "roadmap.sh"],
    ["project-scout", { goal: "I want to become an AI engineer", skills: ["Python"] }, "portfolio.example"],
    ["opportunity-scout", { goal: "I want to become an AI engineer", skills: ["Python"] }, "events.example.org"],
  ];

  for (const [workflow, body, source] of cases) {
    const response = await post(workflow, body);
    const complete = readEvents(await response.text()).find((event) => event.name === "complete").data;
    assert.equal(response.status, 200);
    assert.deepEqual(complete.inaccessibleSources, []);
    assert.ok(complete.uncertainSources.includes(source), `${workflow}: ${JSON.stringify(complete)}`);
  }
});
