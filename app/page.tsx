"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CareerPlan, type CareerPlanSnapshot } from "@/components/career-plan";
import { postResearch } from "@/lib/post-research";

type Job = {
  title: string;
  company: string;
  location: string;
  experience: string;
  skills: string[];
  url: string;
  sourceUrl: string;
};

type ScoutResult = {
  targetRole: string;
  jobs: Job[];
  skills: { name: string; count: number }[];
  sourceCount: number;
  inaccessibleSources: number;
  uncertainSources: number;
  message: string;
};

const suggestedGoals = [
  "I want to become an AI engineer",
  "I want to become a frontend developer",
  "I want to learn data analysis with Python",
];

async function scoutJobs(goal: string, onProgress: (message: string) => void): Promise<ScoutResult> {
  return postResearch<ScoutResult>("/api/job-scout", { goal }, onProgress);
}

function workspaceKey(goal: string) {
  return `pathpilot:workspace:${goal.trim().toLowerCase()}`;
}

function saveWorkspace(goal: string, scout: ScoutResult, plan: CareerPlanSnapshot | null) {
  try {
    localStorage.setItem("pathpilot:last-goal", goal);
    localStorage.setItem(workspaceKey(goal), JSON.stringify({ goal, scout, plan }));
  } catch { /* Browser storage may be unavailable. */ }
}

function subscribeWorkspace(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function getWorkspaceSnapshot() {
  try {
    const goal = localStorage.getItem("pathpilot:last-goal");
    return goal ? localStorage.getItem(workspaceKey(goal)) : null;
  } catch { return null; }
}

function isScoutResult(value: unknown): value is ScoutResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ScoutResult>;
  return typeof data.targetRole === "string" && Array.isArray(data.jobs) && Array.isArray(data.skills);
}

function isCareerPlan(value: unknown): value is CareerPlanSnapshot | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<CareerPlanSnapshot>;
  return (data.roadmap === null || Array.isArray(data.roadmap?.phases)) &&
    (data.projectData === null || (Array.isArray(data.projectData?.projects) && Array.isArray(data.projectData?.practitioners))) &&
    (data.opportunityData === null || Array.isArray(data.opportunityData?.opportunities));
}

export default function Home() {
  const [goal, setGoal] = useState("");
  const [goalEdited, setGoalEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScoutResult | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<CareerPlanSnapshot | null>(null);
  const cachedRaw = useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot, () => null);
  const cachedWorkspace = useMemo(() => {
    try {
      const cached = JSON.parse(cachedRaw || "null");
      if (typeof cached?.goal !== "string" || !isScoutResult(cached.scout) || !isCareerPlan(cached.plan)) return null;
      return cached as { goal: string; scout: ScoutResult; plan: CareerPlanSnapshot | null };
    } catch { return null; }
  }, [cachedRaw]);
  const currentGoal = goalEdited ? goal : goal || cachedWorkspace?.goal || "";
  const currentResult = result || (!goalEdited ? cachedWorkspace?.scout || null : null);
  const currentPlan = planSnapshot || (!goalEdited ? cachedWorkspace?.plan || null : null);
  const currentStatus = status || (!goalEdited ? cachedWorkspace?.scout.message || "" : "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const submittedGoal = currentGoal.trim();
    setGoal(submittedGoal);
    setGoalEdited(true);
    setLoading(true);
    setError("");
    setResult(null);
    setPlanSnapshot(null);
    setStatus("TinyFish Search is finding current job pages…");
    try {
      const data = await scoutJobs(submittedGoal, setStatus);
      setResult(data);
      saveWorkspace(submittedGoal, data, null);
      setStatus(data.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Live research failed. Try again.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Waypoint home">
          <span className="brand-coin" aria-hidden="true">W</span>
          <span>Waypoint</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#job-scout">Explore</a>
          <a href="#roadmap-title">Career plan</a>
          <a href="#workspace-title">Workspace</a>
        </nav>
        <a className="header-cta pixel-button" href="#job-scout">Start your path</a>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <Image className="hero-world" src="/hero.svg" alt="A pixel-art trail through a mountain valley toward a lookout tower" fill priority sizes="100vw" />
          <div className="hero-shade" aria-hidden="true" />
          <div className="hero-copy">
            <p className="pixel-kicker">START YOUR</p>
            <h1 id="hero-title">Career Adventure</h1>
            <p className="hero-subtitle">Find a path to the work you want to do.</p>
            <a className="pixel-button hero-button" href="#job-scout">Get started</a>
          </div>
          <div className="hero-ground-note"><span className="tiny-star" aria-hidden="true">✦</span> Built from the live web</div>
        </section>

        <section className="job-scout section-wrap" id="job-scout" aria-labelledby="scout-title">
          <div className="section-heading">
            <h2 id="scout-title">Every path starts with a goal</h2>
            <p>Tell us what you want to learn or become. Waypoint searches current job pages and shows the employer skills behind your next step.</p>
          </div>

          <form id="goal-form" className="goal-form" onSubmit={handleSubmit}>
            <div className="goal-input-wrap">
              <span className="search-icon" aria-hidden="true" />
              <FieldGroup className="goal-field-group">
                <Field>
                  <FieldLabel htmlFor="goal-input" className="sr-only">What do you want to learn or become?</FieldLabel>
                  <Input
                    id="goal-input"
                    name="goal"
                    type="text"
                    minLength={3}
                    maxLength={240}
                    placeholder="I want to become an AI engineer"
                    autoComplete="off"
                    value={currentGoal}
                    onChange={(event) => { setGoal(event.target.value); setGoalEdited(true); }}
                    aria-describedby="goal-help"
                    required
                  />
                </Field>
              </FieldGroup>
              <Button className="pixel-button scout-button" type="submit" disabled={loading}>
                {loading ? <><Spinner /> Searching…</> : <><Search data-icon="inline-start" /> Scout current jobs</>}
              </Button>
            </div>
            <FieldDescription id="goal-help" className="sr-only">Enter a goal between 3 and 240 characters.</FieldDescription>
            <div className="goal-suggestions" aria-label="Example goals">
              <span>Try a goal:</span>
              {suggestedGoals.map((suggestion) => (
                <Button key={suggestion} type="button" variant="outline" className="suggestion-chip" onClick={() => { setGoal(suggestion); setGoalEdited(true); }}>
                  {suggestion.replace(/^I want to (?:become|learn) /, "").replace(/^(?:a|an|the) /i, "")}
                </Button>
              ))}
            </div>
          </form>

          <div className="research-state" role="status" aria-live="polite" hidden={!loading && !currentStatus}>
            {loading && <Spinner className="size-5" />}
            <span>{currentStatus}</span>
          </div>

          {error && (
            <Alert variant="destructive" className="state-error">
              <AlertTitle>Research could not be completed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {currentResult && (
            <section className="results" aria-labelledby="results-title">
              <div className="results-topline">
                <div>
                  <p className="section-label">LIVE JOB SIGNALS</p>
                  <h3 id="results-title">Hiring signals for {currentResult.targetRole}</h3>
                </div>
                <p className="results-summary">{currentResult.message}</p>
              </div>

              {currentResult.skills.length > 0 && (
                <div className="skill-signals">
                  <h4>Skills showing up in these roles</h4>
                  <div className="skill-list">
                    {currentResult.skills.map((skill) => (
                      <Badge key={skill.name} variant="outline" className="skill-chip">{skill.name} · {skill.count} {skill.count === 1 ? "role" : "roles"}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {currentResult.jobs.length > 0 ? (
                <div className="job-grid">
                  {currentResult.jobs.map((job) => (
                    <Card className="job-card" key={`${job.company}-${job.title}`}>
                      <CardHeader className="job-card-top p-0">
                        <span className="job-company">{job.company}</span>
                        <Badge variant="outline" className="job-status">OPEN · VERIFIED</Badge>
                        <CardTitle role="heading" aria-level={3}>{job.title}</CardTitle>
                        <CardDescription className="job-meta">{[job.location, job.experience].filter((value) => value && value !== "Not listed").join(" · ") || "Details on employer page"}</CardDescription>
                      </CardHeader>
                      <CardContent className="job-skills p-0">
                        {job.skills.map((skill) => <span key={skill}>{skill}</span>)}
                        <a className="job-link" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a>
                        <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">Apply</a>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="empty-result">No open roles could be verified from the sources checked.</p>
              )}
              <p className="source-note">Waypoint checked {currentResult.sourceCount} job source{currentResult.sourceCount === 1 ? "" : "s"}. {currentResult.inaccessibleSources} inaccessible; {currentResult.uncertainSources} uncertain. Confirm each opening on its employer page.</p>
            </section>
          )}
          {currentResult && <CareerPlan key={currentGoal.trim().toLowerCase()} goal={currentGoal.trim()} scout={currentResult} initialPlan={currentPlan} onPlanChange={(plan) => { setPlanSnapshot(plan); saveWorkspace(currentGoal.trim(), currentResult, plan); }} />}
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#top"><span className="brand-coin" aria-hidden="true">W</span><span>Waypoint</span></a>
        <span>Made for the next step in your journey <span aria-hidden="true">✦</span></span>
        <a href="#job-scout">Find your path</a>
      </footer>
    </>
  );
}
