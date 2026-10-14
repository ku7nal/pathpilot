import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
// shortcut: role inference covers common software roles, expand when PathPilot adds new domains.
const roleAliases = [
  [/\b(ai|artificial intelligence)\s+engineer\b/i, "AI Engineer"],
  [/\b(machine learning|ml)\s+engineer\b/i, "Machine Learning Engineer"],
  [/\b(front[ -]?end)\s+(developer|engineer)\b/i, "Frontend Developer"],
  [/\b(back[ -]?end)\s+(developer|engineer)\b/i, "Backend Developer"],
  [/\b(full[ -]?stack)\s+(developer|engineer)\b/i, "Full Stack Developer"],
  [/\b(data scientist)\b/i, "Data Scientist"],
  [/\b(data analyst)\b/i, "Data Analyst"],
  [/\b(software engineer|software developer)\b/i, "Software Engineer"],
  [/\b(game developer|game programmer)\b/i, "Game Developer"],
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const outputSchema = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string", nullable: true },
          experience: { type: "string", nullable: true },
          skills: { type: "array", items: { type: "string" }, maxItems: 12 },
          application_url: { type: "string" },
          is_open: { type: "boolean" },
        },
        required: ["title", "company", "skills", "application_url", "is_open"],
      },
    },
  },
  required: ["jobs"],
};

const roadmapOutputSchema = {
  type: "object",
  properties: {
    inspected_urls: { type: "array", items: { type: "string" }, maxItems: 3 },
    inaccessible_urls: { type: "array", items: { type: "string" }, maxItems: 3 },
    phases: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          order: { type: "integer" },
          title: { type: "string" },
          focus: { type: "string" },
          progression: { type: "string" },
          estimated_hours: { type: "integer" },
          job_relevance: { type: "string" },
          skills: { type: "array", items: { type: "string" }, maxItems: 8 },
          resources: {
            type: "array",
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                provider: { type: "string" },
                reason: { type: "string" },
                related_skills: { type: "array", items: { type: "string" }, maxItems: 6 },
              },
              required: ["title", "url", "provider", "reason", "related_skills"],
            },
          },
        },
        required: ["order", "title", "focus", "progression", "estimated_hours", "job_relevance", "skills", "resources"],
      },
    },
  },
  required: ["inspected_urls", "inaccessible_urls", "phases"],
};

export function inferTargetRole(goal) {
  for (const [pattern, role] of roleAliases) {
    if (pattern.test(goal)) return role;
  }

  const intent = goal.match(/\b(?:become|work as|career as|job as)\s+(?:a|an|the)?\s*([^.!?]+)/i);
  if (intent) return titleCase(intent[1].trim().replace(/^(?:a|an|the)\s+/i, ""));

  const topic = goal.match(/\b(?:learn|study|master)\s+([^.!?]+)/i)?.[1];
  if (topic) {
    const normalized = topic.trim().replace(/^(?:a|an|the)\s+/i, "");
    if (/\b(front[ -]?end|react|javascript|html|css)\b/i.test(normalized)) return "Frontend Developer";
    if (/\b(back[ -]?end|node(?:\.js)?|api development)\b/i.test(normalized)) return "Backend Developer";
    if (/\b(sql|data analysis|pandas)\b/i.test(normalized)) return "Data Analyst";
    if (/\b(machine learning|ml|artificial intelligence|\bai\b)\b/i.test(normalized)) return "AI Engineer";
    return titleCase(normalized);
  }

  return titleCase(goal.trim());
}

function titleCase(value) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function sendEvent(response, type, data) {
  if (!response.destroyed) response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseAgentResult(event) {
  const result = event.result?.result ?? event.result;
  return Array.isArray(result?.jobs) ? result.jobs : [];
}

function cleanRoadmap(event, sourceUrls, targetRole, jobSkills) {
  const result = event.result?.result ?? event.result;
  if (!Array.isArray(result?.phases)) return [];
  const sourceHosts = new Set(sourceUrls.map((value) => new URL(value).hostname.toLowerCase()));
  const seenResources = new Set();
  const relevantTerms = [...jobSkills, targetRole].map((skill) => skill.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean);
  const phases = [];

  for (const phase of result.phases.slice(0, 6)) {
    if (!phase || typeof phase.title !== "string" || typeof phase.focus !== "string" || typeof phase.progression !== "string") continue;
    const resources = [];
    for (const resource of (Array.isArray(phase.resources) ? phase.resources : []).slice(0, 4)) {
      if (!resource || typeof resource.title !== "string" || typeof resource.provider !== "string" || typeof resource.reason !== "string") continue;
      let url;
      try {
        url = new URL(resource.url);
        if (url.protocol !== "https:" || !sourceHosts.has(url.hostname.toLowerCase())) continue;
      } catch {
        continue;
      }
      const relatedSkills = Array.isArray(resource.related_skills) ? resource.related_skills.filter((skill) => typeof skill === "string").slice(0, 6) : [];
      const relevant = relatedSkills.some((related) => {
        const term = related.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        return term && relevantTerms.some((candidate) => candidate === term || candidate.includes(term) || term.includes(candidate));
      });
      if (!relevant) continue;
      const key = `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      resources.push({
        title: resource.title.trim(),
        url: url.href,
        provider: resource.provider.trim(),
        reason: resource.reason.trim(),
        relatedSkills,
      });
    }
    if (!resources.length) continue;
    const estimatedHours = Number(phase.estimated_hours);
    phases.push({
      order: phases.length + 1,
      title: phase.title.trim(),
      focus: phase.focus.trim(),
      progression: phase.progression.trim(),
      estimatedHours: Number.isInteger(estimatedHours) && estimatedHours > 0 && estimatedHours <= 200 ? estimatedHours : null,
      jobRelevance: typeof phase.job_relevance === "string" ? phase.job_relevance.trim() : "",
      skills: Array.isArray(phase.skills) ? phase.skills.filter((skill) => typeof skill === "string").slice(0, 8) : [],
      resources,
    });
  }
  return phases;
}

function isJobBoardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

function cleanJob(job, sourceUrl) {
  if (!job || job.is_open !== true || typeof job.title !== "string" || typeof job.company !== "string") return null;
  let applicationUrl;
  try {
    applicationUrl = new URL(job.application_url);
    if (applicationUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    title: job.title.trim(),
    company: job.company.trim(),
    location: typeof job.location === "string" ? job.location : "Not listed",
    experience: typeof job.experience === "string" ? job.experience : "Not listed",
    skills: Array.isArray(job.skills) ? job.skills.filter((skill) => typeof skill === "string").slice(0, 12) : [],
    url: applicationUrl.href,
    sourceUrl,
  };
}

function skillSignals(jobs) {
  const skills = new Map();
  for (const job of jobs) {
    for (const skill of job.skills) {
      const key = skill.toLocaleLowerCase();
      const current = skills.get(key);
      if (current) current.count += 1;
      else skills.set(key, { name: skill, count: 1 });
    }
  }
  return [...skills.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function readRequestBody(request, limit = 8_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error("Request is too large."), { statusCode: 413 });
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
    return parsed;
  } catch {
    throw Object.assign(new Error("Send a valid JSON object."), { statusCode: 400 });
  }
}

async function runJobScout(request, response) {
  const { goal } = await readRequestBody(request);
  if (typeof goal !== "string" || goal.trim().length < 3 || goal.trim().length > 240) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Enter a goal between 3 and 240 characters." }));
    return;
  }
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Live research needs a server-side TINYFISH_API_KEY." }));
    return;
  }

  const cleanGoal = goal.trim();
  const targetRole = inferTargetRole(cleanGoal);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders?.();
  sendEvent(response, "status", { message: "Searching current public job listings…" });

  try {
    const query = `site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com "${targetRole}" jobs`;
    const searchUrl = new URL("https://api.search.tinyfish.ai");
    searchUrl.searchParams.set("query", query);
    const searchResponse = await fetch(searchUrl, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!searchResponse.ok) throw new Error(`TinyFish Search returned ${searchResponse.status}.`);
    const searchData = await searchResponse.json();
    const seenUrls = new Set();
    const candidates = (searchData.results ?? []).filter((result) => {
      if (!isJobBoardUrl(result.url) || seenUrls.has(result.url)) return false;
      seenUrls.add(result.url);
      return true;
    }).slice(0, 3);

    const jobs = [];
    let inaccessibleSources = 0;
    let uncertainSources = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      sendEvent(response, "status", {
        message: `Checking job source ${index + 1} of ${candidates.length}: ${candidate.site_name || new URL(candidate.url).hostname}`,
      });
      try {
        const agentResponse = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
          method: "POST",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            url: candidate.url,
            goal: `Inspect this public job listing or careers page for current, open ${targetRole} roles relevant to this learner goal: "${cleanGoal}". If this is one job posting, return it only if it is still open. If it is a careers listing, return up to 5 matching open roles. Extract title, company, location, experience requirement, key skills, application URL, and whether the role is currently open. Do not include expired or closed roles. Return only the requested structured data.`,
            output_schema: outputSchema,
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!agentResponse.ok) throw new Error(`TinyFish Agent returned ${agentResponse.status}.`);
        if (!agentResponse.body) throw new Error("TinyFish Agent returned an empty stream.");

        const decoder = new TextDecoder();
        let pending = "";
        let receivedCompletion = false;
        let completed = false;
        const acceptBlock = (block) => {
          const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!data) return;
          let event;
          try { event = JSON.parse(data); } catch { return; }
          if (event.type === "PROGRESS") sendEvent(response, "progress", { message: event.purpose || "Inspecting a job source…" });
          if (event.type === "COMPLETE") {
            receivedCompletion = true;
            completed = event.status === "COMPLETED";
            for (const rawJob of parseAgentResult(event)) {
              const job = cleanJob(rawJob, candidate.url);
              if (job) jobs.push(job);
            }
          }
        };

        for await (const chunk of agentResponse.body) {
          pending += decoder.decode(chunk, { stream: true });
          let boundary;
          while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
            const block = pending.slice(0, boundary);
            const delimiter = pending.match(/\r?\n\r?\n/)[0];
            pending = pending.slice(boundary + delimiter.length);
            acceptBlock(block);
          }
        }
        pending += decoder.decode();
        if (pending.trim()) acceptBlock(pending);
        if (!completed) {
          if (receivedCompletion) uncertainSources += 1;
          else inaccessibleSources += 1;
          sendEvent(response, "progress", { message: receivedCompletion ? "This source returned an uncertain result." : "This source could not be verified." });
        }
      } catch {
        inaccessibleSources += 1;
        sendEvent(response, "progress", { message: `Could not inspect source ${index + 1}; checking the next listing…` });
      }
    }

    const uniqueJobs = [...new Map(jobs.map((job) => [`${job.company.toLowerCase()}|${job.title.toLowerCase()}`, job])).values()];
    sendEvent(response, "complete", {
      targetRole,
      jobs: uniqueJobs,
      skills: skillSignals(uniqueJobs),
      sourceCount: candidates.length,
      inaccessibleSources,
      uncertainSources,
      message: uniqueJobs.length ? "Research complete." : candidates.length ? "No open roles could be verified from these sources." : "No matching job sources were found.",
    });
  } catch (error) {
    sendEvent(response, "error", { message: error.name === "TimeoutError" ? "Research timed out. Try again." : error.message || "Live research failed." });
  } finally {
    if (!response.destroyed) response.end();
  }
}

async function runLearningRoadmap(request, response) {
  const body = await readRequestBody(request);
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim() : "";
  if (goal.length < 3 || goal.length > 240 || !targetRole || targetRole.length > 100 || !Array.isArray(body.skills) || !Array.isArray(body.jobs)) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Submit the goal, inferred target, skills, and job findings from the scout." }));
    return;
  }

  const skills = [...new Set(body.skills.filter((skill) => typeof skill === "string").map((skill) => skill.trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
  const jobs = body.jobs.slice(0, 6).filter((job) => job && typeof job.title === "string").map((job) => ({
    title: job.title.slice(0, 120),
    experience: typeof job.experience === "string" ? job.experience.slice(0, 120) : "Not listed",
    skills: Array.isArray(job.skills) ? job.skills.filter((skill) => typeof skill === "string").slice(0, 12).map((skill) => skill.slice(0, 80)) : [],
  }));
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Live research needs a server-side TINYFISH_API_KEY." }));
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  response.flushHeaders?.();
  const sources = [
    { name: "roadmap.sh", query: `site:roadmap.sh ${targetRole} ${skills.slice(0, 5).join(" ")} learning roadmap` },
    { name: "Codédex", query: `site:codedex.io ${targetRole} ${skills.slice(0, 5).join(" ")} tutorial` },
    { name: "official documentation", query: `${targetRole} official documentation tutorial ${skills.slice(0, 5).join(" ")}` },
  ];

  try {
    sendEvent(response, "status", { message: "Finding learning resources across curated sources…" });
    const searches = await Promise.all(sources.map(async (source) => {
      try {
        const url = new URL("https://api.search.tinyfish.ai");
        url.searchParams.set("query", source.query);
        url.searchParams.set("purpose", `Find trustworthy learning resources for ${targetRole} that cover these employer-reported skills: ${skills.slice(0, 5).join(", ") || targetRole}.`);
        const result = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(30_000) });
        if (!result.ok) throw new Error(`TinyFish Search returned ${result.status}.`);
        return { source, results: (await result.json()).results ?? [] };
      } catch {
        return { source, error: true, results: [] };
      }
    }));
    const inaccessibleSources = searches.filter((item) => item.error).map((item) => item.source.name);
    const sparseSources = [];
    const uncertainSources = [];
    const candidates = [];
    const seen = new Set();
    for (const item of searches) {
      if (item.error) continue;
      const expectedHost = item.source.name === "roadmap.sh" ? "roadmap.sh" : item.source.name === "Codédex" ? "codedex.io" : null;
      const result = item.results.find((entry) => {
        try {
          const url = new URL(entry.url);
          if (url.protocol !== "https:") return false;
          const host = url.hostname.toLowerCase();
          if (expectedHost && host !== expectedHost && !host.endsWith(`.${expectedHost}`)) return false;
          return !seen.has(url.href);
        } catch {
          return false;
        }
      });
      if (!result) {
        sparseSources.push(item.source.name);
        continue;
      }
      const url = new URL(result.url);
      seen.add(url.href);
      candidates.push({ name: item.source.name, title: result.title || "Learning resource", url: url.href, siteName: result.site_name || item.source.name });
    }

    if (!candidates.length) {
      sendEvent(response, "complete", {
        targetRole,
        phases: [],
        checkedSources: [],
        inaccessibleSources,
        sparseSources,
        uncertainSources,
        message: "No learning resources could be verified for this goal. Try again later or use a more specific goal.",
      });
      return;
    }

    sendEvent(response, "status", { message: `Inspecting ${candidates.length} curated resource pages…` });
    let phases = [];
    let checkedSources = [];
    try {
      const agentResponse = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: candidates[0].url,
          goal: `Build a progressive learning roadmap for the learner's goal ${JSON.stringify(goal)} and inferred target ${JSON.stringify(targetRole)}. Employer job findings are ${JSON.stringify(jobs)} and recurring employer skills are ${JSON.stringify(skills)}. Navigate to and inspect each supplied candidate page: ${JSON.stringify(candidates)}. Use roadmap.sh, Codédex, and official documentation/tutorial results where available. Return inspected_urls and inaccessible_urls using only exact URLs from the supplied list; report only pages you actually inspected. Return up to 6 ordered phases from foundations to advanced practice. Each phase must have a focus, explain why it follows the previous phase, estimate generic self-study hours, map to employer skills, and include up to 4 specific resources with the exact HTTPS URL, provider, a short reason, and related_skills. Include only resources that directly teach the target role or employer-reported skills; do not invent sources or claim a page was inspected if it was inaccessible. Return only structured data matching the schema.`,
          output_schema: roadmapOutputSchema,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!agentResponse.ok || !agentResponse.body) throw new Error("TinyFish Agent could not inspect the resource pages.");

      const decoder = new TextDecoder();
      let pending = "";
      let completed = false;
      const acceptBlock = (block) => {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) return;
        let event;
        try { event = JSON.parse(data); } catch { return; }
        if (event.type === "PROGRESS") sendEvent(response, "progress", { message: event.purpose || "Reviewing resource content and prerequisites…" });
        if (event.type === "COMPLETE") {
          completed = event.status === "COMPLETED";
          if (completed) {
            const result = event.result?.result ?? event.result;
            const candidateUrls = new Set(candidates.map((candidate) => candidate.url));
            const inspected = new Set((Array.isArray(result?.inspected_urls) ? result.inspected_urls : []).filter((url) => candidateUrls.has(url)));
            const inaccessible = new Set((Array.isArray(result?.inaccessible_urls) ? result.inaccessible_urls : []).filter((url) => candidateUrls.has(url) && !inspected.has(url)));
            checkedSources = candidates.filter((candidate) => inspected.has(candidate.url)).map((candidate) => candidate.name);
            inaccessibleSources.push(...candidates.filter((candidate) => inaccessible.has(candidate.url)).map((candidate) => candidate.name));
            uncertainSources.push(...candidates.filter((candidate) => !inspected.has(candidate.url) && !inaccessible.has(candidate.url)).map((candidate) => candidate.name));
            phases = cleanRoadmap(event, [...inspected], targetRole, skills);
          }
        }
      };
      for await (const chunk of agentResponse.body) {
        pending += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
          const block = pending.slice(0, boundary);
          const delimiter = pending.match(/\r?\n\r?\n/)[0];
          pending = pending.slice(boundary + delimiter.length);
          acceptBlock(block);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) acceptBlock(pending);
      if (!completed) inaccessibleSources.push(...candidates.map((candidate) => candidate.name));
    } catch {
      inaccessibleSources.push(...candidates.map((candidate) => candidate.name));
    }

    sendEvent(response, "complete", {
      targetRole,
      phases,
      checkedSources,
      inaccessibleSources,
      sparseSources,
      uncertainSources,
      message: phases.length ? "Your job-aligned roadmap is ready." : "No learning resources could be verified for this goal. Try again later or use a more specific goal.",
    });
  } catch (error) {
    sendEvent(response, "error", { message: error.name === "TimeoutError" ? "Roadmap research timed out. Try again." : error.message || "Live roadmap research failed." });
  } finally {
    if (!response.destroyed) response.end();
  }
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = resolve(publicRoot, `.${requestedPath}`);
  if (!filePath.startsWith(`${publicRoot}${sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

export function createServer() {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "POST" && url.pathname === "/api/job-scout") {
      try {
        await runJobScout(request, response);
      } catch (error) {
        const statusCode = error.statusCode || 500;
        if (!response.headersSent) response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
        if (!response.destroyed) response.end(JSON.stringify({ error: error.message || "The request could not be completed." }));
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/learning-roadmap") {
      try {
        await runLearningRoadmap(request, response);
      } catch (error) {
        const statusCode = error.statusCode || 500;
        if (!response.headersSent) response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
        if (!response.destroyed) response.end(JSON.stringify({ error: error.message || "The request could not be completed." }));
      }
      return;
    }
    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = createServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "127.0.0.1", () => console.log(`PathPilot is running at http://127.0.0.1:${port}`));
}
