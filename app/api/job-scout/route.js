import { inferTargetRole } from "../../../lib/target-role.mjs";
import { billingRequest } from "../../../lib/billing-backend.mjs";
import { clerkConvexToken, clerkUserId } from "../../../lib/clerk-auth.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

const jobSchema = {
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

function jsonError(status, message) {
  return Response.json({ error: message }, { status });
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
  if (!job || job.is_open !== true || typeof job.title !== "string" || !job.title.trim() || typeof job.company !== "string" || !job.company.trim() || !isJobBoardUrl(job.application_url)) return null;
  return {
    title: job.title.trim().slice(0, 160),
    company: job.company.trim().slice(0, 120),
    location: typeof job.location === "string" ? job.location.slice(0, 120) : "Not listed",
    experience: typeof job.experience === "string" ? job.experience.slice(0, 120) : "Not listed",
    skills: Array.isArray(job.skills) ? job.skills.filter((skill) => typeof skill === "string").slice(0, 12) : [],
    url: new URL(job.application_url).href,
    sourceUrl,
  };
}

function skillSignals(jobs) {
  const signals = new Map();
  for (const job of jobs) {
    for (const skill of new Set(job.skills.map((item) => item.trim()).filter(Boolean))) {
      const key = skill.toLocaleLowerCase();
      const current = signals.get(key);
      if (current) current.count += 1;
      else signals.set(key, { name: skill, count: 1 });
    }
  }
  return [...signals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function agentResult(event) {
  const result = event?.result?.result ?? event?.result ?? {};
  return Array.isArray(result.jobs) ? result.jobs : [];
}

async function readAgentStream(response, onProgress) {
  if (!response.ok || !response.body) throw new Error(`TinyFish Agent returned ${response.status}.`);
  const decoder = new TextDecoder();
  let pending = "";
  let complete = false;
  let jobs = [];
  const acceptBlock = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.type === "PROGRESS") onProgress(event.purpose || "Inspecting a job source…");
    if (event.type === "COMPLETE") {
      complete = event.status === "COMPLETED";
      if (complete) jobs = agentResult(event);
    }
  };

  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
      const delimiter = pending.match(/\r?\n\r?\n/)[0];
      acceptBlock(pending.slice(0, boundary));
      pending = pending.slice(boundary + delimiter.length);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) acceptBlock(pending);
  if (!complete) throw new Error("TinyFish Agent could not verify the source pages.");
  return jobs;
}

function send(controller, type, data) {
  controller.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request, _context, getUserId = clerkUserId, billing = billingRequest, getToken = clerkConvexToken) {
  const userId = await getUserId();
  if (!userId) return jsonError(401, "Sign in to run job research.");
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return jsonError(400, "Send a valid JSON object.");
    const decoder = new TextDecoder();
    let raw = "";
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000) {
        await reader.cancel();
        return jsonError(413, "Request is too large.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "Send a valid JSON object.");
  } catch {
    return jsonError(400, "Send a valid JSON object.");
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length < 3 || goal.length > 240) return jsonError(400, "Enter a goal between 3 and 240 characters.");
  if (typeof body.reservationId !== "string") return jsonError(400, "Start a complete plan before researching.");
  let token;
  try {
    token = await getToken();
    if (!(await billing("billing", { kind: "claimWorkflow", reservationId: body.reservationId, workflow: "job-scout" }, token)).claimed) return jsonError(409, "This plan step was already started or its reservation expired. Start a new plan.");
  } catch { return jsonError(503, "Could not verify your plan allowance."); }

  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) {
    try { await billing("billing", { kind: "recordWorkflow", reservationId: body.reservationId, workflow: "job-scout", succeeded: false }, token); } catch {}
    return jsonError(503, "Live research needs a server-side TINYFISH_API_KEY.");
  }

  const targetRole = inferTargetRole(goal);
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  let streamController;
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      const emit = (type, data) => {
        if (!cancelled) send(controller, type, data);
      };
      void (async () => {
        emit("status", { message: "Searching current public job listings…" });
        let succeeded = false;
        try {
          const searchUrl = new URL("https://api.search.tinyfish.ai");
          searchUrl.searchParams.set("query", `site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com \"${targetRole}\" jobs`);
          const searchResponse = await fetch(searchUrl, {
            headers: { "X-API-Key": apiKey },
            signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(30_000)]),
          });
          if (!searchResponse.ok) throw new Error(`TinyFish Search returned ${searchResponse.status}.`);
          const searchData = await searchResponse.json();
          const seenUrls = new Set();
          const candidates = (Array.isArray(searchData.results) ? searchData.results : []).filter((item) => {
            if (!isJobBoardUrl(item.url) || seenUrls.has(item.url)) return false;
            seenUrls.add(item.url);
            return true;
          }).slice(0, 3);

          const jobs = [];
          let inaccessibleSources = 0;
          let uncertainSources = 0;
          for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            emit("status", { message: `Checking job source ${index + 1} of ${candidates.length}: ${candidate.site_name || new URL(candidate.url).hostname}` });
            try {
              const agentResponse = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
                method: "POST",
                headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: candidate.url,
                  goal: `Inspect this public job listing or careers page for current, open ${targetRole} roles relevant to this learner goal: ${JSON.stringify(goal)}. If this is one job posting, return it only if it is still open. If this is a careers listing, return up to 5 matching open roles. Extract title, company, location, experience requirement, key skills, application URL, and whether the role is currently open. Do not include expired or closed roles. Return only the requested structured data.`,
                  output_schema: jobSchema,
                }),
                signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(90_000)]),
              });
              const foundJobs = await readAgentStream(agentResponse, (message) => emit("progress", { message }));
              for (const rawJob of foundJobs) {
                const job = cleanJob(rawJob, candidate.url);
                if (job) jobs.push(job);
              }
            } catch (error) {
              if (abortController.signal.aborted) throw error;
              if (error.name === "TimeoutError" || error.name === "AbortError") inaccessibleSources += 1;
              else uncertainSources += 1;
              emit("progress", { message: `Could not verify source ${index + 1}; checking the next listing…` });
            }
          }

          const uniqueJobs = [...new Map(jobs.map((job) => [`${job.company.toLowerCase()}|${job.title.toLowerCase()}`, job])).values()];
          emit("complete", {
            targetRole,
            jobs: uniqueJobs,
            skills: skillSignals(uniqueJobs),
            sourceCount: candidates.length,
            inaccessibleSources,
            uncertainSources,
            message: uniqueJobs.length ? "Research complete." : candidates.length ? "No open roles could be verified from these sources." : "No matching job sources were found.",
          });
          succeeded = true;
        } catch (error) {
          if (!abortController.signal.aborted) emit("error", { message: error.name === "TimeoutError" ? "Research timed out. Try again." : error.message || "Live research failed." });
        } finally {
          try { await billing("billing", { kind: "recordWorkflow", reservationId: body.reservationId, workflow: "job-scout", succeeded }, await getToken()); } catch { emit("error", { message: "Usage could not be settled. Please try again." }); }
          if (!cancelled) streamController.close();
        }
      })();
    },
    cancel() {
      cancelled = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
