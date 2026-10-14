const form = document.querySelector("#goal-form");
const goalInput = document.querySelector("#goal-input");
const researchState = document.querySelector("#research-state");
const results = document.querySelector("#results");
const resultsTitle = document.querySelector("#results-title");
const resultsSummary = document.querySelector("#results-summary");
const sourceNote = document.querySelector("#source-note");
const skillSignals = document.querySelector("#skill-signals");
const skillList = document.querySelector("#skill-list");
const jobList = document.querySelector("#job-list");
const submitButton = form.querySelector("button[type='submit']");
const buildRoadmapButton = document.querySelector("#build-roadmap");
const roadmapState = document.querySelector("#roadmap-state");
const roadmap = document.querySelector("#roadmap");
const roadmapSummary = document.querySelector("#roadmap-summary");
const roadmapCoverage = document.querySelector("#roadmap-coverage");
const roadmapPhases = document.querySelector("#roadmap-phases");
const projects = document.querySelector("#projects");
const projectList = document.querySelector("#project-list");
const opportunities = document.querySelector("#opportunities");
const opportunityList = document.querySelector("#opportunity-list");
const workspace = document.querySelector("#workspace");
const workspaceStats = document.querySelector("#workspace-stats");
const nextSteps = document.querySelector("#next-steps");
const savedResources = document.querySelector("#saved-resources");
let demo = null;
let completed = new Set();
let saved = new Set();

const examples = {
  ai: {
    role: "AI Engineer",
    skills: [["Python", 3], ["LLM APIs", 2], ["FastAPI", 2], ["SQL", 2], ["Evaluation", 2]],
    jobs: [
      ["Northstar Labs", "Junior AI Engineer", "Remote · Entry level", ["Python", "LLM APIs", "FastAPI"], "https://jobs.lever.co/"],
      ["Orbit Systems", "Applied AI Developer", "New York · 1–3 years", ["Python", "SQL", "Evaluation"], "https://www.linkedin.com/jobs/"],
      ["Cedar AI", "Machine Learning Engineer", "Remote · Early career", ["Python", "FastAPI", "LLM APIs"], "https://wellfound.com/jobs"]
    ],
    phases: [
      ["Python & data foundations", "Build confidence with Python, Git, and working with data.", "Start with the language and data skills that every later project depends on.", 12, ["Python", "Git", "SQL"], [["Python Tutorial", "Python Docs", "https://docs.python.org/3/tutorial/", "Official documentation for core Python concepts."], ["SQLBolt", "SQLBolt", "https://sqlbolt.com/", "Interactive practice for querying relational data."]]],
      ["Build APIs with AI models", "Connect model APIs to a small, reliable application.", "Once the foundations are familiar, package model behavior behind an API.", 16, ["LLM APIs", "FastAPI", "Testing"], [["FastAPI Tutorial", "FastAPI", "https://fastapi.tiangolo.com/tutorial/", "Learn to structure and serve API endpoints."], ["Hugging Face Learn", "Hugging Face", "https://huggingface.co/learn", "Explore practical model and NLP lessons."]]],
      ["Evaluate & ship an AI feature", "Measure quality, add retrieval, and deploy an end-to-end feature.", "Evaluation and deployment turn a working prototype into a portfolio-ready system.", 20, ["Evaluation", "RAG", "Deployment"], [["OpenAI Cookbook", "OpenAI Cookbook", "https://cookbook.openai.com/", "Examples of model integration and evaluation patterns."], ["Docker Get Started", "Docker", "https://docs.docker.com/get-started/", "Learn to package an application for deployment."]]]
    ],
    projects: [["Data Q&A API", "Starter", "Python basics", "Turn a small CSV into a tested API with clear error handling.", ["Load and inspect a dataset", "Create a FastAPI endpoint", "Add input validation and tests"]], ["AI study assistant", "Intermediate", "Data Q&A API", "Build a grounded assistant that cites the source material it uses.", ["Ingest and chunk documents", "Add retrieval and source citations", "Evaluate answers on a small test set"]], ["Career research copilot", "Capstone", "API, retrieval, and evaluation", "Combine job search, skill analysis, and a grounded learning plan.", ["Collect and normalize job signals", "Generate a cited skill-gap report", "Deploy the app and document evaluation results"]]]
  },
  frontend: {
    role: "Frontend Developer",
    skills: [["JavaScript", 3], ["React", 3], ["CSS", 2], ["Accessibility", 2], ["Testing", 2]],
    jobs: [["Northstar Labs", "Junior Frontend Developer", "Remote · Entry level", ["JavaScript", "React", "CSS"], "https://jobs.lever.co/"], ["Orbit Systems", "UI Engineer", "New York · 1–3 years", ["React", "Accessibility", "Testing"], "https://www.linkedin.com/jobs/"], ["Cedar AI", "Web Developer", "Remote · Early career", ["JavaScript", "CSS", "React"], "https://wellfound.com/jobs"]],
    phases: [["Web foundations", "Learn semantic HTML, CSS layout, JavaScript, and Git.", "Strong browser fundamentals make framework concepts easier to understand.", 12, ["HTML", "CSS", "JavaScript"], [["MDN Learn Web Development", "MDN", "https://developer.mozilla.org/en-US/docs/Learn", "A structured path through web fundamentals."], ["JavaScript Guide", "MDN", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide", "Reference and guided learning for modern JavaScript."]]], ["React & interface patterns", "Build reusable components, forms, and responsive interfaces.", "Apply the fundamentals to component-based UI and real interaction states.", 16, ["React", "State", "Responsive UI"], [["React Learn", "React", "https://react.dev/learn", "The official hands-on introduction to React."], ["web.dev Learn", "web.dev", "https://web.dev/learn/", "Courses on modern, accessible web development."]]], ["Test & ship polished products", "Add accessibility, tests, and a production deployment workflow.", "Quality checks and deployment show you can deliver beyond a local prototype.", 14, ["Accessibility", "Testing", "Deployment"], [["Testing Library", "Testing Library", "https://testing-library.com/docs/", "Test UI through behavior that matters to users."], ["Vite Guide", "Vite", "https://vite.dev/guide/", "Build and deploy a modern frontend project."]]]],
    projects: [["Responsive portfolio", "Starter", "HTML and CSS", "Create a fast, accessible personal site across screen sizes.", ["Sketch a page structure", "Build responsive sections", "Check keyboard and color contrast"]], ["Interactive dashboard", "Intermediate", "JavaScript and React", "Make a data-rich dashboard with reusable components and states.", ["Create reusable cards and filters", "Add loading and empty states", "Write interaction tests"]], ["Capstone product UI", "Capstone", "React, accessibility, and testing", "Ship a polished multi-screen app with thoughtful interactions.", ["Define a user flow", "Build and test the key screens", "Deploy and write a project case study"]]]
  },
  data: {
    role: "Data Analyst",
    skills: [["SQL", 3], ["Python", 2], ["Excel", 2], ["Visualization", 2], ["Statistics", 2]],
    jobs: [["Northstar Labs", "Junior Data Analyst", "Remote · Entry level", ["SQL", "Python", "Visualization"], "https://jobs.lever.co/"], ["Orbit Systems", "Product Analyst", "New York · 1–3 years", ["SQL", "Statistics", "Excel"], "https://www.linkedin.com/jobs/"], ["Cedar AI", "Operations Analyst", "Remote · Early career", ["Python", "SQL", "Excel"], "https://wellfound.com/jobs"]],
    phases: [["Spreadsheets & SQL", "Organize data, query tables, and check data quality.", "Start by learning how to inspect and shape the data that analysis depends on.", 10, ["Excel", "SQL", "Data quality"], [["SQLBolt", "SQLBolt", "https://sqlbolt.com/", "Interactive SQL practice from basic queries onward."], ["Excel Training", "Microsoft", "https://support.microsoft.com/en-us/excel", "Official guides for spreadsheet workflows."]]], ["Python for analysis", "Use Python to clean data and answer repeatable questions.", "After basic querying, automate analyses and work with larger datasets.", 14, ["Python", "Pandas", "Visualization"], [["Python Tutorial", "Python Docs", "https://docs.python.org/3/tutorial/", "Learn the Python language used in analysis workflows."], ["Pandas Getting Started", "Pandas", "https://pandas.pydata.org/docs/getting_started/", "Official introduction to tabular data analysis."]]], ["Communicate insights", "Apply statistics and visualization to explain a real decision.", "The final step turns analysis into clear recommendations others can act on.", 12, ["Statistics", "Storytelling", "Dashboards"], [["Kaggle Learn", "Kaggle", "https://www.kaggle.com/learn", "Short practical courses in analysis and visualization."], ["Tableau Learning", "Tableau", "https://www.tableau.com/learn/training", "Learn to build and communicate with dashboards."]]]],
    projects: [["Clean sales report", "Starter", "Spreadsheets and SQL", "Turn messy transaction data into a trusted summary.", ["Inspect columns and missing values", "Write core SQL summaries", "Explain data quality decisions"]], ["Customer trends notebook", "Intermediate", "SQL and Python", "Analyze customer behavior and visualize useful segments.", ["Load and clean the data", "Compare cohorts and trends", "Write a short findings summary"]], ["Decision dashboard", "Capstone", "Analysis, statistics, and visualization", "Create an end-to-end dashboard with recommendations and caveats.", ["Choose a real decision question", "Build and validate the metrics", "Present findings and limitations"]]]
  }
};

for (const chip of document.querySelectorAll(".suggestion-chip")) chip.addEventListener("click", () => { goalInput.value = chip.dataset.goal; goalInput.focus(); });

function link(parent, label, href, className = "job-link") {
  const a = document.createElement("a"); a.className = className; a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; parent.append(a);
}

function setStatus(message, error = false) {
  researchState.hidden = false; researchState.classList.toggle("state-error", error); researchState.textContent = message;
}

function chooseExample(goal) {
  const text = goal.toLowerCase();
  return examples.frontend && /front.?end|web developer|react|ui developer/.test(text) ? examples.frontend
    : /data analyst|data analysis|analytics|sql/.test(text) ? examples.data : examples.ai;
}

function renderJobs() {
  const data = demo;
  results.hidden = false; resultsTitle.textContent = `Sample hiring signals for ${data.role}`;
  resultsSummary.textContent = "Illustrative roles and recurring skills"; jobList.replaceChildren(); skillList.replaceChildren();
  for (const [name, count] of data.skills) { const chip = document.createElement("span"); chip.className = "skill-chip"; chip.textContent = `${name} · ${count} sample roles`; skillList.append(chip); }
  skillSignals.hidden = false;
  for (const [companyName, titleText, metaText, tags, href] of data.jobs) {
    const card = document.createElement("article"); card.className = "job-card";
    const top = document.createElement("div"); top.className = "job-card-top";
    const company = document.createElement("span"); company.className = "job-company"; company.textContent = companyName;
    const badge = document.createElement("span"); badge.className = "demo-badge"; badge.textContent = "SAMPLE"; top.append(company, badge);
    const title = document.createElement("h4"); title.textContent = titleText;
    const meta = document.createElement("p"); meta.className = "job-meta"; meta.textContent = metaText;
    const skills = document.createElement("div"); skills.className = "job-skills";
    tags.forEach((tag) => { const span = document.createElement("span"); span.textContent = tag; skills.append(span); });
    card.append(top, title, meta, skills); link(card, "Browse job listings", href); jobList.append(card);
  }
  sourceNote.textContent = "Illustrative demo roles and skill counts; not live openings or verified employer requirements.";
}

function renderRoadmap() {
  roadmap.hidden = false; roadmapSummary.textContent = `A sample progression for your ${demo.role} goal.`; roadmapPhases.replaceChildren();
  demo.phases.forEach(([titleText, focusText, progressionText, hours, skills, resources], index) => {
    const card = document.createElement("article"); card.className = "roadmap-phase";
    const head = document.createElement("div"); head.className = "roadmap-phase-heading";
    const num = document.createElement("span"); num.className = "phase-number"; num.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("div"); copy.className = "phase-heading-copy";
    const h = document.createElement("h4"); h.textContent = titleText; const focus = document.createElement("p"); focus.className = "phase-focus"; focus.textContent = focusText; copy.append(h, focus);
    const time = document.createElement("span"); time.className = "phase-hours"; time.textContent = `ABOUT ${hours} HOURS`; head.append(num, copy, time); card.append(head);
    const why = document.createElement("p"); why.className = "phase-progression"; why.textContent = `Why this comes next: ${progressionText}`; card.append(why);
    const tags = document.createElement("div"); tags.className = "phase-skills"; skills.forEach((name) => { const tag = document.createElement("span"); tag.className = "phase-skill"; tag.textContent = name; tags.append(tag); }); card.append(tags);
    const resourceWrap = document.createElement("div"); resourceWrap.className = "phase-resources";
    resources.forEach(([name, provider, href, reason]) => { const item = document.createElement("div"); item.className = "roadmap-resource"; const providerText = document.createElement("p"); providerText.className = "resource-provider"; providerText.textContent = provider; item.append(providerText); link(item, name, href, "resource-link"); const p = document.createElement("p"); p.className = "resource-reason"; p.textContent = reason; item.append(p); resourceWrap.append(item); });
    card.append(resourceWrap); roadmapPhases.append(card);
  });
  roadmapCoverage.textContent = "Demo curriculum and study-hour estimates. Resource links point to public learning sites; no live source research was performed.";
}

function renderProjects() {
  projectList.replaceChildren();
  demo.projects.forEach(([title, difficulty, prerequisites, description, milestones], projectIndex) => {
    const card = document.createElement("article"); card.className = "project-card";
    const top = document.createElement("div"); top.className = "job-card-top"; const h = document.createElement("h4"); h.textContent = title; const badge = document.createElement("span"); badge.className = "demo-badge"; badge.textContent = difficulty; top.append(h, badge);
    const p = document.createElement("p"); p.className = "project-description"; p.textContent = description;
    const prereq = document.createElement("p"); prereq.className = "project-prereq"; prereq.textContent = `Prerequisite: ${prerequisites} · Portfolio value: ${projectIndex === 2 ? "High" : "Practice"}`;
    const list = document.createElement("div"); list.className = "milestones";
    milestones.forEach((milestone, index) => { const id = `${projectIndex}-${index}`; const label = document.createElement("label"); label.className = "milestone"; const input = document.createElement("input"); input.type = "checkbox"; input.checked = completed.has(id); input.dataset.milestone = id; const span = document.createElement("span"); span.textContent = milestone; label.append(input, span); list.append(label); });
    card.append(top, p, prereq, list); projectList.append(card);
  });
}

function renderOpportunities() {
  const items = [["Oct 22", "Open source contribution sprint", "Online · Beginner friendly", "Find a small issue and make your first public contribution.", "https://goodfirstissue.dev/"], ["Nov 07", "Community AI build weekend", "Online · Team event", "A sample event slot for planning a portfolio build.", "https://devpost.com/hackathons"], ["Nov 18", "Early career role review", "Remote · Open to learners", "Use this reminder to review relevant company career pages.", "https://www.linkedin.com/jobs/"]];
  opportunityList.replaceChildren();
  for (const [date, title, metaText, description, href] of items) { const card = document.createElement("article"); card.className = "opportunity-card"; const dateEl = document.createElement("div"); dateEl.className = "opportunity-date"; dateEl.textContent = date; const body = document.createElement("div"); const h = document.createElement("h4"); h.textContent = title; const meta = document.createElement("p"); meta.className = "job-meta"; meta.textContent = metaText; const desc = document.createElement("p"); desc.className = "project-description"; desc.textContent = description; body.append(h, meta, desc); link(body, "Explore source", href, "resource-link"); card.append(dateEl, body); opportunityList.append(card); }
}

function renderWorkspace() {
  const tasks = demo.projects.flatMap((project, pi) => project[4].map((_, mi) => `${pi}-${mi}`));
  const done = tasks.filter((id) => completed.has(id)).length;
  workspaceStats.replaceChildren();
  [[`${Math.round(done / tasks.length * 100)}%`, "Illustrative progress"], [String(demo.jobs.length), "Sample job matches"], [String(demo.projects.length), "Portfolio projects"], [String(3), "Sample opportunities"]].forEach(([value, label]) => { const card = document.createElement("div"); card.className = "stat-card"; const strong = document.createElement("strong"); strong.textContent = value; const span = document.createElement("span"); span.textContent = label; card.append(strong, span); workspaceStats.append(card); });
  nextSteps.replaceChildren();
  const next = tasks.find((id) => !completed.has(id));
  const nextText = next ? demo.projects[Number(next.split("-")[0])][4][Number(next.split("-")[1])] : "All sample milestones complete — polish and share your capstone.";
  const action = document.createElement("div"); action.className = "next-step-card"; action.textContent = nextText; nextSteps.append(action);
  savedResources.replaceChildren();
  const resources = demo.phases.flatMap((phase) => phase[5]);
  resources.forEach(([name, , href], index) => { const row = document.createElement("div"); row.className = "saved-resource-row"; const save = document.createElement("button"); save.className = "save-button"; save.type = "button"; save.dataset.save = String(index); save.textContent = saved.has(index) ? "★ Saved" : "☆ Save"; const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = name; row.append(save, a); savedResources.append(row); });
}

async function buildRoadmap() {
  if (!demo) return;
  buildRoadmapButton.disabled = true; buildRoadmapButton.textContent = "Building…"; roadmapState.hidden = false; roadmapState.classList.remove("state-error"); roadmapState.textContent = "Putting your sample learning path together…";
  await new Promise((resolve) => setTimeout(resolve, 350));
  renderRoadmap(); roadmap.hidden = false; projects.hidden = false; opportunities.hidden = false; workspace.hidden = false; renderProjects(); renderOpportunities(); renderWorkspace();
  roadmapState.hidden = true; buildRoadmapButton.disabled = false; buildRoadmapButton.textContent = "Build my roadmap";
}

buildRoadmapButton.addEventListener("click", buildRoadmap);
projectList.addEventListener("change", (event) => { const id = event.target.dataset.milestone; if (!id) return; if (event.target.checked) completed.add(id); else completed.delete(id); renderWorkspace(); });
savedResources.addEventListener("click", (event) => { const index = Number(event.target.dataset.save); if (!Number.isInteger(index)) return; saved.has(index) ? saved.delete(index) : saved.add(index); renderWorkspace(); });

form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!form.reportValidity()) return;
  demo = chooseExample(goalInput.value); completed = new Set(); saved = new Set(); submitButton.disabled = true; submitButton.textContent = "Building…";
  results.hidden = true; roadmap.hidden = true; projects.hidden = true; opportunities.hidden = true; workspace.hidden = true; roadmapState.hidden = true;
  setStatus("Building a sample career path…"); await new Promise((resolve) => setTimeout(resolve, 300));
  renderJobs(); setStatus("Demo path ready. This page uses illustrative sample data."); submitButton.disabled = false; submitButton.textContent = "Build my demo path"; results.scrollIntoView({ behavior: "smooth", block: "start" });
});
