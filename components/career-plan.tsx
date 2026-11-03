"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type Job = { title: string; company: string; experience: string; skills: string[] };
type Skill = { name: string; count: number };
type Resource = { title: string; url: string; provider: string; reason: string; relatedSkills: string[] };
type Phase = { order: number; title: string; focus: string; progression: string; estimatedHours: number | null; jobRelevance: string; skills: string[]; resources: Resource[] };
type Practitioner = { name: string; role: string; url: string; skills: string[]; summary: string };
type Project = { title: string; difficulty: string; prerequisites: string[]; rationale: string; portfolioValue: string; roadmapPhase: string; skills: string[]; practitioners: string[]; milestones: string[]; sources: { title: string; url: string }[] };
type Opportunity = { title: string; type: string; summary: string; date: string; dateLabel: string; eligibility: string; location: string; sourceUrl: string; sourceTitle: string; applicationUrl: string };
type Coverage = { checkedSources: (string | { title: string; url: string })[]; inaccessibleSources: string[]; sparseSources: string[]; uncertainSources: string[]; message: string };
type Roadmap = Coverage & { phases: Phase[] };
type Projects = Coverage & { practitioners: Practitioner[]; projects: Project[] };
type Opportunities = Coverage & { opportunities: Opportunity[] };
type JobScout = { targetRole: string; jobs: Job[]; skills: Skill[] };
type Workflow = "learning-roadmap" | "project-scout" | "opportunity-scout";
type Status = { state: "idle" | "loading" | "done" | "error"; message: string };

const initialStatus: Status = { state: "idle", message: "" };

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function coverageText(data: Coverage) {
  const parts = [`TinyFish verified ${data.checkedSources.length} source${data.checkedSources.length === 1 ? "" : "s"}.`];
  if (data.checkedSources.length) parts.push(`Reviewed: ${data.checkedSources.map((item) => typeof item === "string" ? item : item.title).join(", ")}.`);
  if (data.sparseSources.length) parts.push(`No useful matches from: ${data.sparseSources.join(", ")}.`);
  if (data.inaccessibleSources.length) parts.push(`Could not access: ${data.inaccessibleSources.join(", ")}.`);
  if (data.uncertainSources.length) parts.push(`Could not verify: ${data.uncertainSources.join(", ")}.`);
  return parts.join(" ");
}

async function research(workflow: Workflow, body: object, progress: (message: string) => void) {
  const response = await fetch(`/api/${workflow}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Live research could not start.");
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("The research service returned an unexpected response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: Record<string, unknown> | null = null;
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let boundary;
    while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
      const delimiter = pending.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
      const block = pending.slice(0, boundary);
      const name = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataText = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      pending = pending.slice(boundary + delimiter.length);
      if (!name || !dataText) continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(dataText); } catch { continue; }
      if (["status", "progress"].includes(name) && typeof data.message === "string") progress(data.message);
      if (name === "complete") result = data;
      if (name === "error") throw new Error(typeof data.message === "string" ? data.message : "Live research failed.");
    }
    if (done) break;
  }
  if (!result) throw new Error("The research stream ended before results were returned.");
  return result;
}

export function CareerPlan({ goal, scout }: { goal: string; scout: JobScout }) {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [projectData, setProjectData] = useState<Projects | null>(null);
  const [opportunityData, setOpportunityData] = useState<Opportunities | null>(null);
  const [statuses, setStatuses] = useState<Record<Workflow, Status>>({ "learning-roadmap": initialStatus, "project-scout": initialStatus, "opportunity-scout": initialStatus });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const progressKey = `pathpilot:${goal.trim().toLowerCase()}`;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(progressKey) || "{}");
      setSaved(Array.isArray(stored.saved) ? stored.saved.filter((url: unknown) => typeof url === "string") : []);
      setCompleted(Array.isArray(stored.completed) ? stored.completed.filter((key: unknown) => typeof key === "string") : []);
    } catch { setSaved([]); setCompleted([]); }
    setProgressLoaded(true);
  }, [progressKey]);

  function persist(nextSaved: string[], nextCompleted: string[]) {
    setSaved(nextSaved);
    setCompleted(nextCompleted);
    try { localStorage.setItem(progressKey, JSON.stringify({ saved: nextSaved, completed: nextCompleted })); } catch { /* Browser storage may be unavailable. */ }
  }

  async function buildPlan() {
    setStarted(true);
    setLoading(true);
    setError("");
    setRoadmap(null);
    setProjectData(null);
    setOpportunityData(null);
    const body = { goal, targetRole: scout.targetRole, skills: scout.skills.map((item) => item.name), jobs: scout.jobs };
    const run = async (workflow: Workflow, setData: (data: Record<string, unknown>) => void) => {
      setStatuses((current) => ({ ...current, [workflow]: { state: "loading", message: "Waiting for TinyFish…" } }));
      try {
        const data = await research(workflow, body, (message) => setStatuses((current) => ({ ...current, [workflow]: { state: "loading", message } })));
        setData(data);
        setStatuses((current) => ({ ...current, [workflow]: { state: "done", message: String(data.message || "Research complete.") } }));
      } catch (caught) {
        setStatuses((current) => ({ ...current, [workflow]: { state: "error", message: caught instanceof Error ? caught.message : "Live research failed." } }));
      }
    };
    await Promise.all([
      run("learning-roadmap", (data) => setRoadmap(data as unknown as Roadmap)),
      run("project-scout", (data) => setProjectData(data as unknown as Projects)),
      run("opportunity-scout", (data) => setOpportunityData(data as unknown as Opportunities)),
    ]);
    setLoading(false);
  }

  const projects = projectData?.projects || [];
  const milestoneKeys = projects.flatMap((project) => project.milestones.map((milestone) => `${project.title}\u0000${milestone}`));
  const completedMilestones = milestoneKeys.filter((key) => completed.includes(key)).length;
  const nextMilestone = projects.flatMap((project) => project.milestones.map((milestone) => ({ project, milestone }))).find(({ project, milestone }) => !completed.includes(`${project.title}\u0000${milestone}`));
  const allResources = roadmap?.phases.flatMap((phase) => phase.resources) || [];
  const savedResources = allResources.filter((resource) => saved.includes(resource.url));
  const upcoming = (opportunityData?.opportunities || []).filter((item) => Date.parse(`${item.date}T00:00:00Z`) >= Date.now()).slice(0, 4);

  return (
    <>
      <div className="roadmap-action-row">
        <Button className="pixel-button" type="button" disabled={loading} onClick={buildPlan}>
          {loading && <Spinner />}{loading ? "Researching your plan…" : started ? "Refresh learning, projects & opportunities" : "Research learning, projects & opportunities"}
        </Button>
      </div>
      {error && <Alert variant="destructive" className="state-error"><AlertTitle>Plan research could not be completed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {started && (
        <>
          <section className="roadmap" aria-labelledby="roadmap-title">
            <div className="results-topline"><div><p className="section-label">YOUR LEARNING PATH</p><h3 id="roadmap-title">Job-aligned roadmap</h3></div><p className="results-summary">{roadmap?.message || "Curated learning resources mapped to employer skills."}</p></div>
            <WorkflowStatus status={statuses["learning-roadmap"]} />
            {roadmap && <><p className="source-note">{coverageText(roadmap)}</p><div className="roadmap-phases">
              {roadmap.phases.map((phase) => <Card className="roadmap-phase" key={`${phase.order}-${phase.title}`}><div className="roadmap-phase-heading"><span className="phase-number">{String(phase.order).padStart(2, "0")}</span><div className="phase-heading-copy"><CardTitle>{phase.title}</CardTitle><CardDescription className="phase-focus">{phase.focus}</CardDescription></div><span className="phase-hours">{phase.estimatedHours ? `ABOUT ${phase.estimatedHours} HOURS` : "HOURS NOT ESTIMATED"}</span></div><p className="phase-progression">Why this comes next: {phase.progression}</p>{phase.jobRelevance && <p className="phase-relevance">Job signal: {phase.jobRelevance}</p>}<div className="phase-skills">{phase.skills.map((skill) => <Badge key={skill} variant="outline" className="phase-skill">{skill}</Badge>)}</div><div className="phase-resources">{phase.resources.map((resource) => <div className="roadmap-resource" key={resource.url}><p className="resource-provider">{resource.provider}</p>{safeUrl(resource.url) && <a href={safeUrl(resource.url)} target="_blank" rel="noopener noreferrer">{resource.title}</a>}<p className="resource-reason">{resource.reason}</p><Button type="button" variant="outline" size="sm" disabled={!progressLoaded} onClick={() => persist(saved.includes(resource.url) ? saved.filter((url) => url !== resource.url) : [...saved, resource.url], completed)}>{saved.includes(resource.url) ? "★ Saved" : "☆ Save"}</Button></div>)}</div></Card>)}
            </div></>}
          </section>

          <section className="workspace-section" aria-labelledby="projects-title"><div className="results-topline"><div><p className="section-label">PRACTITIONER RESEARCH</p><h3 id="projects-title">Projects & milestones</h3></div><p className="results-summary">Recommendations cite the work that informed them.</p></div><WorkflowStatus status={statuses["project-scout"]} />{projectData && <><p className="source-note">{coverageText(projectData)}</p><div className="practitioner-grid">{projectData.practitioners.map((person) => <Card className="practitioner-card" key={person.url}><CardHeader className="p-0"><CardTitle>{person.name}</CardTitle><CardDescription className="job-meta">{person.role}</CardDescription></CardHeader><CardContent className="p-0"><p className="project-description">{person.summary}</p><div className="phase-skills">{person.skills.map((skill) => <Badge variant="outline" className="phase-skill" key={skill}>{skill}</Badge>)}</div>{safeUrl(person.url) && <a className="resource-link" href={safeUrl(person.url)} target="_blank" rel="noopener noreferrer">View inspected work</a>}</CardContent></Card>)}</div><div className="project-grid">{projectData.projects.map((project) => <Card className="project-card" key={project.title}><CardHeader className="p-0"><div className="job-card-top"><CardTitle>{project.title}</CardTitle><Badge variant="outline" className="project-level">{project.difficulty}</Badge></div></CardHeader><CardContent className="p-0"><p className="project-description">{project.rationale}</p>{project.roadmapPhase && <p className="project-prereq">Roadmap phase: {project.roadmapPhase}</p>}{project.prerequisites.length > 0 && <p className="project-prereq">Prerequisites: {project.prerequisites.join(", ")}</p>}{project.portfolioValue && <p className="project-prereq">Portfolio value: {project.portfolioValue}</p>}<div className="phase-skills">{project.skills.map((skill) => <Badge variant="outline" className="phase-skill" key={skill}>{skill}</Badge>)}</div><div className="milestones">{project.milestones.map((milestone) => { const key = `${project.title}\u0000${milestone}`; return <label className="milestone" key={key}><input type="checkbox" checked={completed.includes(key)} disabled={!progressLoaded} onChange={(event) => persist(saved, event.target.checked ? [...completed, key] : completed.filter((item) => item !== key))} /><span>{milestone}</span></label>; })}</div>{project.sources.map((source) => safeUrl(source.url) && <a className="resource-link" key={source.url} href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">Evidence: {source.title}</a>)}</CardContent></Card>)}</div>{projectData.projects.length === 0 && <p className="empty-result">{projectData.message}</p>}</>}</section>

          <section className="workspace-section" aria-labelledby="opportunities-title"><div className="results-topline"><div><p className="section-label">LIVE OPPORTUNITIES</p><h3 id="opportunities-title">Upcoming opportunities</h3></div><p className="results-summary">Dates appear only when verified on an official source page.</p></div><WorkflowStatus status={statuses["opportunity-scout"]} />{opportunityData && <><p className="source-note">{coverageText(opportunityData)}</p><div className="opportunity-list">{opportunityData.opportunities.map((item) => <Card className="opportunity-card" key={`${item.title}-${item.date}`}><div className="opportunity-date">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${item.date}T00:00:00`))}</div><div><h4>{item.title}</h4><p className="job-meta">{item.type} · {item.dateLabel}</p><p className="project-description">{item.summary}</p><p className="project-prereq">Eligibility: {item.eligibility} · {item.location}</p>{safeUrl(item.sourceUrl) && <a className="resource-link" href={safeUrl(item.sourceUrl)} target="_blank" rel="noopener noreferrer">Official page: {item.sourceTitle}</a>}{safeUrl(item.applicationUrl) && <a className="job-link" href={safeUrl(item.applicationUrl)} target="_blank" rel="noopener noreferrer">Application details</a>}</div></Card>)}{opportunityData.opportunities.length === 0 && <p className="empty-result">{opportunityData.message}</p>}</div></>}</section>

          <section className="workspace-section" aria-labelledby="workspace-title"><div className="results-topline"><div><p className="section-label">YOUR CAREER WORKSPACE</p><h3 id="workspace-title">Your next steps</h3></div><p className="results-summary">Progress is saved in this browser for this goal.</p></div><div className="workspace-stats">{[[scout.jobs.length, "Verified job matches"], [roadmap?.phases.length ?? "—", "Roadmap phases"], [projectData?.projects.length ?? "—", "Source-backed projects"], [opportunityData?.opportunities.length ?? "—", "Upcoming opportunities"], [`${completedMilestones}/${milestoneKeys.length}`, "Milestones complete"]].map(([value, label]) => <Card className="stat-card" key={label}><strong>{value}</strong><span>{label}</span></Card>)}</div><div className="workspace-columns"><div><h4>Recommended next</h4><div className="next-steps"><Card className="next-step-card">{nextMilestone ? `${nextMilestone.project.title}: ${nextMilestone.milestone}` : projects.length ? "All researched project milestones are complete." : "Run project research to find a next step."}</Card></div><h4 className="notification-heading">Upcoming dates</h4><div className="saved-resources">{upcoming.length ? upcoming.map((item) => <p className="deadline-notice" key={item.title}>{item.dateLabel}: {item.title} · {item.date}</p>) : <p className="empty-result">No verified opportunity dates are available.</p>}</div></div><div><h4>Saved resources</h4><div className="saved-resources">{savedResources.length ? savedResources.map((resource) => <div className="saved-resource-row" key={resource.url}><a href={safeUrl(resource.url)} target="_blank" rel="noopener noreferrer">{resource.title}</a><Button type="button" variant="ghost" size="sm" onClick={() => persist(saved.filter((url) => url !== resource.url), completed)}>Remove</Button></div>) : <p className="empty-result">Save a researched learning resource to keep it here.</p>}</div></div></div></section>
        </>
      )}
    </>
  );
}

function WorkflowStatus({ status }: { status: Status }) {
  if (status.state === "idle") return null;
  return <div className={`research-state ${status.state === "error" ? "state-error" : ""}`} role="status" aria-live="polite">{status.state === "loading" && <Spinner className="size-5" />}<span>{status.message}</span></div>;
}
