# PathPilot

PathPilot helps learners turn a software career goal into a practical plan. It includes a goal intake, job-skill research, a sequenced learning roadmap, portfolio projects and milestones, an opportunity timeline, and a progression workspace.

## Current prototype

The browser UI currently uses illustrative sample data for job cards, projects, opportunities, calendar dates, progress, and notifications. Those values are not live or verified. Goal selection, roadmap display, resource saving, and milestone progress work locally in the page; saved state resets on refresh.

The server also provides live TinyFish endpoints for job scouting and learning-roadmap research. The current browser UI does not call those endpoints. Project/practitioner scouting and opportunity discovery are sample UI flows, not live TinyFish workflows yet.

## Requirements

- Node.js 20 or newer
- A TinyFish API key only when calling the live server endpoints

There are no npm dependencies to install.

## Run locally

```sh
node server.mjs
```

Open <http://127.0.0.1:3000>. Enter a goal and choose **Build my demo path**. Choose **Build my roadmap** to reveal projects, opportunities, and the workspace. Check project milestones and save resources to see the demo progression update.

To use the live endpoints, provide the key to the server process. Do not commit the key or put it in browser code.

```sh
export TINYFISH_API_KEY='your-key'
node server.mjs
```

The server routes are `POST /api/job-scout` and `POST /api/learning-roadmap`. Both require a JSON request and return Server-Sent Events with progress and completion data. Without a key, they return a setup error rather than inventing live results.

TinyFish API details: [Agent](https://docs.tinyfish.ai/agent-api), [Search](https://docs.tinyfish.ai/search-api), [Fetch](https://docs.tinyfish.ai/fetch-api), and [Browser](https://docs.tinyfish.ai/browser-api).

## Run checks

```sh
node --test
```

## Project structure

- `server.mjs` — static server and TinyFish research endpoints
- `public/` — PathPilot interface, styles, and artwork
- `test/` — server endpoint tests with mocked TinyFish responses
- `docs/agents/` — local repository conventions

Feature specs and tickets are kept in the ignored `.scratch/` directory for local planning.
