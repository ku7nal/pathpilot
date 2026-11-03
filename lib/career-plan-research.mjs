import { inferTargetRole } from "./target-role.mjs";

const roadmapSchema = { type: "object", properties: { inspected_urls: { type: "array", items: { type: "string" }, maxItems: 3 }, inaccessible_urls: { type: "array", items: { type: "string" }, maxItems: 3 }, phases: { type: "array", maxItems: 6, items: { type: "object", properties: { order: { type: "integer" }, title: { type: "string" }, focus: { type: "string" }, progression: { type: "string" }, estimated_hours: { type: "integer" }, job_relevance: { type: "string" }, skills: { type: "array", items: { type: "string" }, maxItems: 8 }, resources: { type: "array", maxItems: 4, items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" }, provider: { type: "string" }, reason: { type: "string" }, related_skills: { type: "array", items: { type: "string" }, maxItems: 6 } }, required: ["title", "url", "provider", "reason", "related_skills"] } } }, required: ["order", "title", "focus", "progression", "estimated_hours", "job_relevance", "skills", "resources"] } } }, required: ["inspected_urls", "inaccessible_urls", "phases"] };
const projectSchema = { type: "object", properties: { inspected_urls: { type: "array", items: { type: "string" }, maxItems: 5 }, inaccessible_urls: { type: "array", items: { type: "string" }, maxItems: 5 }, practitioners: { type: "array", maxItems: 5, items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, profile_url: { type: "string" }, demonstrated_skills: { type: "array", items: { type: "string" }, maxItems: 8 }, work_summary: { type: "string" } }, required: ["name", "role", "profile_url", "demonstrated_skills", "work_summary"] } }, projects: { type: "array", maxItems: 5, items: { type: "object", properties: { title: { type: "string" }, difficulty: { type: "string" }, prerequisites: { type: "array", items: { type: "string" }, maxItems: 8 }, rationale: { type: "string" }, portfolio_value: { type: "string" }, roadmap_phase: { type: "string" }, skills: { type: "array", items: { type: "string" }, maxItems: 8 }, practitioner_names: { type: "array", items: { type: "string" }, maxItems: 5 }, milestones: { type: "array", items: { type: "string" }, maxItems: 8 }, source_urls: { type: "array", items: { type: "string" }, maxItems: 5 } }, required: ["title", "difficulty", "prerequisites", "rationale", "portfolio_value", "roadmap_phase", "skills", "practitioner_names", "milestones", "source_urls"] } } }, required: ["inspected_urls", "inaccessible_urls", "practitioners", "projects"] };
const opportunitySchema = { type: "object", properties: { inspected_urls: { type: "array", items: { type: "string" }, maxItems: 6 }, inaccessible_urls: { type: "array", items: { type: "string" }, maxItems: 6 }, opportunities: { type: "array", maxItems: 10, items: { type: "object", properties: { title: { type: "string" }, type: { type: "string" }, summary: { type: "string" }, date: { type: "string" }, date_label: { type: "string" }, date_evidence: { type: "string" }, official_evidence: { type: "string" }, eligibility: { type: "string" }, location: { type: "string" }, source_url: { type: "string" }, source_is_official: { type: "boolean" }, application_url: { type: "string" } }, required: ["title", "type", "summary", "date", "date_label", "date_evidence", "official_evidence", "eligibility", "location", "source_url", "source_is_official", "application_url"] } } }, required: ["inspected_urls", "inaccessible_urls", "opportunities"] };

const uniqueStrings = (items, max, length = 80) => [...new Set((Array.isArray(items) ? items : []).filter((item) => typeof item === "string").map((item) => item.trim().slice(0, length)).filter(Boolean))].slice(0, max);

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !host.includes(":");
  } catch { return false; }
}

async function search(query, purpose, apiKey, signal, afterDate) {
  const url = new URL("https://api.search.tinyfish.ai");
  url.searchParams.set("query", query);
  url.searchParams.set("purpose", purpose);
  if (afterDate) url.searchParams.set("after_date", afterDate);
  const response = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  if (!response.ok) throw new Error(`TinyFish Search returned ${response.status}.`);
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function fetchPages(urls, apiKey, signal) {
  if (!urls.length) return [];
  const response = await fetch("https://api.fetch.tinyfish.ai", { method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ urls: urls.slice(0, 10), format: "markdown", ttl: 0 }), signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) });
  if (!response.ok) throw new Error(`TinyFish Fetch returned ${response.status}.`);
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function runAgent(url, goal, schema, apiKey, emit, signal) {
  const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", { method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ url, goal, output_schema: schema }), signal: AbortSignal.any([signal, AbortSignal.timeout(150_000)]) });
  if (!response.ok || !response.body) throw new Error(`TinyFish Agent returned ${response.status}.`);
  const decoder = new TextDecoder();
  let pending = "";
  let result;
  let completed = false;
  const parse = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.type === "PROGRESS") emit("progress", { message: event.purpose || "Inspecting source pages…" });
    if (event.type === "COMPLETE") {
      completed = event.status === "COMPLETED";
      result = event.result?.result ?? event.result;
    }
  };
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
      const delimiter = pending.match(/\r?\n\r?\n/)[0];
      parse(pending.slice(0, boundary));
      pending = pending.slice(boundary + delimiter.length);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) parse(pending);
  if (!completed || !result) throw new Error("TinyFish Agent could not verify the source pages.");
  return result;
}

function candidatesFrom(results, limit) {
  const seen = new Set();
  return results.filter((item) => {
    if (!isPublicHttpsUrl(item?.url) || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, limit).map((item) => ({ title: typeof item.title === "string" ? item.title.slice(0, 180) : new URL(item.url).hostname, url: new URL(item.url).href, siteName: typeof item.site_name === "string" ? item.site_name.slice(0, 100) : new URL(item.url).hostname }));
}

function sourceCoverage(candidates, inspected, inaccessible) {
  return {
    checked: candidates.filter((item) => inspected.has(item.url)),
    inaccessible: candidates.filter((item) => inaccessible.has(item.url)),
    uncertain: candidates.filter((item) => !inspected.has(item.url) && !inaccessible.has(item.url)),
  };
}

function pageText(pages, url) {
  const identity = (value) => { try { const item = new URL(value); return `${item.origin}${item.pathname.replace(/\/+$/, "")}`; } catch { return ""; } };
  const key = identity(url);
  const page = pages.find((item) => identity(item.url) === key || identity(item.final_url) === key);
  return typeof page?.text === "string" ? page.text : "";
}

function cleanRoadmap(result, inspectedUrls, targetRole, jobSkills) {
  if (!Array.isArray(result?.phases)) return [];
  const hosts = new Set(inspectedUrls.map((url) => new URL(url).hostname.toLowerCase()));
  const relevantTerms = [...jobSkills, targetRole].map((skill) => skill.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean);
  const seen = new Set();
  return result.phases.slice(0, 6).flatMap((phase) => {
    if (!phase || typeof phase.title !== "string" || typeof phase.focus !== "string" || typeof phase.progression !== "string") return [];
    const resources = (Array.isArray(phase.resources) ? phase.resources : []).slice(0, 4).flatMap((resource) => {
      if (!resource || typeof resource.title !== "string" || typeof resource.provider !== "string" || typeof resource.reason !== "string") return [];
      let url;
      try { url = new URL(resource.url); } catch { return []; }
      if (url.protocol !== "https:" || !hosts.has(url.hostname.toLowerCase())) return [];
      const relatedSkills = Array.isArray(resource.related_skills) ? resource.related_skills.filter((item) => typeof item === "string").slice(0, 6) : [];
      const relevant = relatedSkills.some((related) => {
        const term = related.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        return term && relevantTerms.some((candidate) => candidate === term || candidate.includes(term) || term.includes(candidate));
      });
      const key = `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
      if (!relevant || seen.has(key)) return [];
      seen.add(key);
      return [{ title: resource.title.trim(), url: url.href, provider: resource.provider.trim(), reason: resource.reason.trim(), relatedSkills }];
    });
    if (!resources.length) return [];
    const hours = Number(phase.estimated_hours);
    return [{ order: 0, title: phase.title.trim(), focus: phase.focus.trim(), progression: phase.progression.trim(), estimatedHours: Number.isInteger(hours) && hours > 0 && hours <= 200 ? hours : null, jobRelevance: typeof phase.job_relevance === "string" ? phase.job_relevance.trim() : "", skills: Array.isArray(phase.skills) ? phase.skills.filter((item) => typeof item === "string").slice(0, 8) : [], resources }];
  }).map((phase, index) => ({ ...phase, order: index + 1 }));
}

function readGoalAndSkills(body) {
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length < 3 || goal.length > 240) throw new Error("Enter a goal between 3 and 240 characters.");
  const selectedRole = typeof body.targetRole === "string" ? body.targetRole.trim().slice(0, 100) : "";
  return { goal, targetRole: selectedRole || inferTargetRole(goal), skills: uniqueStrings(Array.isArray(body.skills) ? body.skills : [], 20) };
}

async function roadmap(body, emit, apiKey, signal) {
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim() : "";
  if (goal.length < 3 || goal.length > 240 || !targetRole || targetRole.length > 100 || !Array.isArray(body.skills) || !Array.isArray(body.jobs)) throw new Error("Submit the goal, inferred target, skills, and job findings from the scout.");
  const skills = uniqueStrings(body.skills, 20);
  const jobs = body.jobs.slice(0, 6).filter((job) => job && typeof job.title === "string").map((job) => ({ title: job.title.slice(0, 120), experience: typeof job.experience === "string" ? job.experience.slice(0, 120) : "Not listed", skills: uniqueStrings(Array.isArray(job.skills) ? job.skills : [], 12) }));
  const sources = [
    { name: "roadmap.sh", query: `site:roadmap.sh ${targetRole} ${skills.slice(0, 5).join(" ")} learning roadmap`, host: "roadmap.sh" },
    { name: "Codédex", query: `site:codedex.io ${targetRole} ${skills.slice(0, 5).join(" ")} tutorial`, host: "codedex.io" },
    { name: "official documentation", query: `${targetRole} official documentation tutorial ${skills.slice(0, 5).join(" ")}` },
  ];
  emit("status", { message: "Finding learning resources across curated sources…" });
  const searches = await Promise.all(sources.map(async (source) => {
    try { return { source, results: await search(source.query, `Find trustworthy learning resources for ${targetRole} that cover these employer-reported skills: ${skills.slice(0, 5).join(", ") || targetRole}.`, apiKey, signal) }; }
    catch { return { source, results: [], error: true }; }
  }));
  if (searches.every((item) => item.error)) throw new Error("TinyFish Search is temporarily unavailable.");
  const inaccessibleSources = [];
  const sparseSources = [];
  const uncertainSources = searches.filter((item) => item.error).map((item) => `${item.source.name} search`);
  const candidates = [];
  const seen = new Set();
  for (const item of searches) {
    const result = item.results.find((entry) => {
      try {
        const url = new URL(entry.url);
        return url.protocol === "https:" && (!item.source.host || url.hostname === item.source.host || url.hostname.endsWith(`.${item.source.host}`)) && !seen.has(url.href);
      } catch { return false; }
    });
    if (!result) { if (!item.error) sparseSources.push(item.source.name); continue; }
    const url = new URL(result.url);
    seen.add(url.href);
    candidates.push({ name: item.source.name, title: result.title || "Learning resource", url: url.href, siteName: result.site_name || item.source.name });
  }
  if (!candidates.length) return { targetRole, phases: [], checkedSources: [], inaccessibleSources, sparseSources, uncertainSources, message: "No learning resources could be verified for this goal. Try again later or use a more specific goal." };
  emit("status", { message: `Inspecting ${candidates.length} curated resource pages…` });
  let phases = [];
  let checkedSources = [];
  try {
    let fetched = [];
    try { emit("progress", { message: "TinyFish Fetch is reading the discovered learning pages…" }); fetched = await fetchPages(candidates.map((item) => item.url), apiKey, signal); }
    catch { uncertainSources.push("TinyFish Fetch"); }
    const extracts = candidates.map((item) => ({ url: item.url, title: item.title, content: pageText(fetched, item.url).slice(0, 2_000) }));
    const result = await runAgent(candidates[0].url, `Build a progressive learning roadmap for goal ${JSON.stringify(goal)} and target role ${JSON.stringify(targetRole)}. Employer findings: ${JSON.stringify(jobs)}. Recurring employer skills: ${JSON.stringify(skills)}. TinyFish Fetch extracted these page contents: ${JSON.stringify(extracts)}. Inspect each supplied page. Return inspected_urls and inaccessible_urls using exact candidate URLs only. Return up to 6 ordered phases from foundational to advanced. Explain progression, estimate hours, map to employer skills, and cite relevant resources using exact HTTPS candidate URLs. Do not invent sources or claim an inaccessible page was inspected.`, roadmapSchema, apiKey, emit, signal);
    const candidateUrls = new Set(candidates.map((item) => item.url));
    const inspected = new Set((Array.isArray(result.inspected_urls) ? result.inspected_urls : []).filter((url) => candidateUrls.has(url)));
    const inaccessible = new Set((Array.isArray(result.inaccessible_urls) ? result.inaccessible_urls : []).filter((url) => candidateUrls.has(url) && !inspected.has(url)));
    const coverage = sourceCoverage(candidates, inspected, inaccessible);
    checkedSources = coverage.checked.map((item) => item.name);
    inaccessibleSources.push(...coverage.inaccessible.map((item) => item.name));
    uncertainSources.push(...coverage.uncertain.map((item) => item.name));
    phases = cleanRoadmap(result, [...inspected], targetRole, skills);
  } catch (error) {
    throw new Error(error.name === "TimeoutError" ? "TinyFish Agent timed out." : "TinyFish Agent could not verify the learning resources.");
  }
  return { targetRole, phases, checkedSources, inaccessibleSources, sparseSources, uncertainSources, resourceSourceCount: checkedSources.length, message: phases.length ? "Your job-aligned roadmap is ready." : "No learning resources could be verified for this goal. Try again later or use a more specific goal." };
}

async function projects(body, emit, apiKey, signal) {
  const { goal, targetRole, skills } = readGoalAndSkills(body);
  const inaccessibleSources = [];
  const sparseSources = [];
  const uncertainSources = [];
  emit("status", { message: "TinyFish Search is finding public practitioner work and project portfolios…" });
  const queries = [`"${targetRole}" practitioner portfolio projects ${skills.slice(0, 4).join(" ")}`, `site:github.com ${targetRole} open source portfolio repository ${skills.slice(0, 4).join(" ")}`, `"${targetRole}" engineer personal website projects GitHub`];
  const searches = await Promise.all(queries.map(async (query) => {
    try { return await search(query, `Find real public practitioner portfolios and repositories that demonstrate ${targetRole} work.`, apiKey, signal); }
    catch { uncertainSources.push("TinyFish Search query"); return []; }
  }));
  if (uncertainSources.length === queries.length) throw new Error("TinyFish Search is temporarily unavailable.");
  const candidates = candidatesFrom(searches.flat(), 5);
  if (!candidates.length) return { targetRole, practitioners: [], projects: [], checkedSources: [], inaccessibleSources, sparseSources: ["Practitioner portfolios"], uncertainSources, message: "Search returned no practitioner pages that could be inspected." };
  emit("progress", { message: `TinyFish Fetch is extracting ${candidates.length} candidate pages…` });
  let fetched = [];
  try { fetched = await fetchPages(candidates.map((item) => item.url), apiKey, signal); }
  catch { uncertainSources.push("TinyFish Fetch"); }
  const extracts = candidates.map((item) => ({ ...item, content: pageText(fetched, item.url).slice(0, 2_000) }));
  let result;
  try {
    result = await runAgent(candidates[0].url, `Inspect public practitioner pages for target role ${JSON.stringify(targetRole)} and goal ${JSON.stringify(goal)}. Relevant job skills: ${JSON.stringify(skills)}. Page extracts: ${JSON.stringify(extracts)}. Identify practitioners only when a public identity is visible. Recommend up to 5 original project briefs only when a pattern is supported by at least two named practitioners and two inspected pages; do not claim the briefs are projects they built. Include prerequisites and actionable milestones. Return exact inspected candidate URLs only. Do not invent names, work, links, or inspection results.`, projectSchema, apiKey, emit, signal);
  } catch (error) {
    throw new Error(error.name === "TimeoutError" ? "TinyFish Agent timed out." : "Practitioner pages could not be verified.");
  }
  const candidateMap = new Map(candidates.map((item) => [item.url, item]));
  const inspected = new Set((Array.isArray(result.inspected_urls) ? result.inspected_urls : []).filter((url) => candidateMap.has(url)));
  const inaccessible = new Set((Array.isArray(result.inaccessible_urls) ? result.inaccessible_urls : []).filter((url) => candidateMap.has(url) && !inspected.has(url)));
  const coverage = sourceCoverage(candidates, inspected, inaccessible);
  const checkedSources = coverage.checked.map(({ title, url }) => ({ title, url }));
  inaccessibleSources.push(...coverage.inaccessible.map((item) => item.siteName));
  uncertainSources.push(...coverage.uncertain.map((item) => item.siteName));
  const practitioners = (Array.isArray(result.practitioners) ? result.practitioners : []).filter((item) => typeof item?.name === "string" && item.name.trim() && typeof item.role === "string" && inspected.has(item.profile_url) && typeof item.work_summary === "string").map((item) => ({ name: item.name.slice(0, 100), role: item.role.slice(0, 120), url: item.profile_url, skills: uniqueStrings(item.demonstrated_skills || [], 8), summary: item.work_summary.slice(0, 500) })).slice(0, 5);
  const verifiedNames = new Set(practitioners.map((item) => item.name.toLocaleLowerCase()));
  const projectResults = (Array.isArray(result.projects) ? result.projects : []).flatMap((item) => {
    if (typeof item?.title !== "string" || typeof item.rationale !== "string" || !Array.isArray(item.milestones)) return [];
    const sources = [...new Set((Array.isArray(item.source_urls) ? item.source_urls : []).filter((url) => inspected.has(url)))].map((url) => ({ title: candidateMap.get(url).title, url }));
    const practitionerNames = [...new Set((Array.isArray(item.practitioner_names) ? item.practitioner_names : []).filter((name) => typeof name === "string" && verifiedNames.has(name.toLocaleLowerCase())))];
    const milestones = uniqueStrings(item.milestones, 8, 240);
    if (sources.length < 2 || practitionerNames.length < 2 || !milestones.length) return [];
    return [{ title: item.title.slice(0, 140), difficulty: String(item.difficulty || "").slice(0, 60), prerequisites: uniqueStrings(item.prerequisites || [], 8), rationale: item.rationale.slice(0, 500), portfolioValue: String(item.portfolio_value || "").slice(0, 200), roadmapPhase: String(item.roadmap_phase || "").slice(0, 120), skills: uniqueStrings(item.skills || [], 8), practitioners: practitionerNames, milestones, sources }];
  }).slice(0, 5);
  return { targetRole, practitioners, projects: projectResults, checkedSources, inaccessibleSources, sparseSources, uncertainSources, message: projectResults.length ? "Practitioner research and project recommendations are ready." : "No project recommendation had enough inspected source evidence to include." };
}

function normalizedText(value) { return value.toLocaleLowerCase().replace(/\s+/g, " ").trim(); }

async function opportunities(body, emit, apiKey, signal) {
  const { goal, targetRole, skills } = readGoalAndSkills(body);
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const inaccessibleSources = [];
  const sparseSources = [];
  const uncertainSources = [];
  emit("status", { message: "TinyFish Search is finding upcoming official opportunities…" });
  const queries = [`upcoming ${targetRole} hackathons competitions official ${year} ${skills.slice(0, 3).join(" ")}`, `${targetRole} internship applications deadline careers ${year} official ${skills.slice(0, 3).join(" ")}`, `upcoming technology events competitions ${targetRole} official registration ${year}`];
  const searches = await Promise.all(queries.map(async (query) => {
    try { return await search(query, `Find official pages for opportunities with a date after ${today}.`, apiKey, signal, today); }
    catch { uncertainSources.push("TinyFish Search query"); return []; }
  }));
  if (uncertainSources.length === queries.length) throw new Error("TinyFish Search is temporarily unavailable.");
  const candidates = candidatesFrom(searches.flat(), 6);
  if (!candidates.length) return { targetRole, opportunities: [], checkedSources: [], inaccessibleSources, sparseSources: ["Official opportunity pages"], uncertainSources, message: "Search returned no official opportunity pages to inspect." };
  emit("progress", { message: `TinyFish Fetch is extracting ${candidates.length} opportunity pages…` });
  let fetched = [];
  try { fetched = await fetchPages(candidates.map((item) => item.url), apiKey, signal); }
  catch { uncertainSources.push("TinyFish Fetch"); }
  const extracts = candidates.map((item) => ({ ...item, content: pageText(fetched, item.url).slice(0, 2_000) }));
  let result;
  try {
    result = await runAgent(candidates[0].url, `Find relevant internships, hackathons, competitions, and career events for target ${JSON.stringify(targetRole)} and goal ${JSON.stringify(goal)}. Skills: ${JSON.stringify(skills)}. Today's date is ${today}. Page extracts: ${JSON.stringify(extracts)}. Only include opportunities with a date or deadline after today, evidenced by an exact short quote in fetched source text. Also return an exact short quotation from the inspected page that identifies the organizer or official publisher. Use exact candidate source URLs, include the explicitly shown application URL, and do not infer dates, official status, or eligibility.`, opportunitySchema, apiKey, emit, signal);
  } catch (error) {
    throw new Error(error.name === "TimeoutError" ? "TinyFish Agent timed out." : "Opportunity pages could not be verified.");
  }
  const candidateMap = new Map(candidates.map((item) => [item.url, item]));
  const inspected = new Set((Array.isArray(result.inspected_urls) ? result.inspected_urls : []).filter((url) => candidateMap.has(url)));
  const inaccessible = new Set((Array.isArray(result.inaccessible_urls) ? result.inaccessible_urls : []).filter((url) => candidateMap.has(url) && !inspected.has(url)));
  const coverage = sourceCoverage(candidates, inspected, inaccessible);
  const checkedSources = coverage.checked.map(({ title, url }) => ({ title, url }));
  inaccessibleSources.push(...coverage.inaccessible.map((item) => item.siteName));
  uncertainSources.push(...coverage.uncertain.map((item) => item.siteName));
  const found = [];
  for (const item of Array.isArray(result.opportunities) ? result.opportunities : []) {
    const source = candidateMap.get(item?.source_url);
    const date = typeof item?.date === "string" ? item.date : "";
    const evidence = typeof item?.date_evidence === "string" ? item.date_evidence : "";
    const sourceContent = normalizedText(source && pageText(fetched, source.url));
    const officialEvidence = typeof item?.official_evidence === "string" ? item.official_evidence : "";
    const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    const applicationUrl = isPublicHttpsUrl(item.application_url) ? new URL(item.application_url).href : "";
    if (!source || item.source_is_official !== true || !inspected.has(source.url) || !applicationUrl || (applicationUrl !== source.url && !sourceContent.includes(normalizedText(applicationUrl))) || !evidence || !sourceContent.includes(normalizedText(evidence)) || !officialEvidence || !sourceContent.includes(normalizedText(officialEvidence)) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date || date <= today || typeof item.title !== "string") continue;
    found.push({ title: item.title.slice(0, 160), type: String(item.type || "Opportunity").slice(0, 60), summary: String(item.summary || "").slice(0, 500), date, dateLabel: String(item.date_label || "Date").slice(0, 80), officialEvidence, eligibility: String(item.eligibility || "Not stated on the source page").slice(0, 300), location: String(item.location || "Not stated on the source page").slice(0, 120), sourceUrl: source.url, sourceTitle: source.title, applicationUrl });
  }
  const unique = [...new Map(found.map((item) => [`${item.title.toLowerCase()}|${item.date}`, item])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return { targetRole, opportunities: unique, checkedSources, inaccessibleSources, sparseSources, uncertainSources, message: unique.length ? "Upcoming opportunities verified from official pages." : "No upcoming opportunity had a verifiable future date on the inspected pages." };
}

export function validateCareerPlanInput(workflow, body) {
  if (workflow === "learning-roadmap") {
    if (typeof body.goal !== "string" || body.goal.trim().length < 3 || body.goal.trim().length > 240 || typeof body.targetRole !== "string" || !body.targetRole.trim() || body.targetRole.trim().length > 100 || !Array.isArray(body.skills) || !Array.isArray(body.jobs)) return "Submit the goal, inferred target, skills, and job findings from the scout.";
  } else if (typeof body.goal !== "string" || body.goal.trim().length < 3 || body.goal.trim().length > 240) return "Enter a goal between 3 and 240 characters.";
  return null;
}

export async function runCareerPlanResearch(workflow, body, emit, signal) {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error("Live research needs a server-side TINYFISH_API_KEY.");
  const result = workflow === "learning-roadmap" ? await roadmap(body, emit, apiKey, signal) : workflow === "project-scout" ? await projects(body, emit, apiKey, signal) : await opportunities(body, emit, apiKey, signal);
  emit("complete", result);
}
