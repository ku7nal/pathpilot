import { runCareerPlanResearch, validateCareerPlanInput } from "../../../lib/career-plan-research.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

const workflows = new Set(["learning-roadmap", "project-scout", "opportunity-scout"]);

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8_000) {
      await reader.cancel();
      return "too-large";
    }
    raw += decoder.decode(value, { stream: true });
  }
  try {
    const body = JSON.parse(raw + decoder.decode());
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

async function clerkUserId() {
  const { auth } = await import("@clerk/nextjs/server");
  return (await auth()).userId;
}

export async function POST(request, { params }, getUserId = clerkUserId) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Sign in to run career research." }, { status: 401 });
  const { workflow } = await params;
  if (!workflows.has(workflow)) return Response.json({ error: "Unknown research workflow." }, { status: 404 });
  let body;
  try { body = await readJson(request); }
  catch { return Response.json({ error: "Send a valid JSON object." }, { status: 400 }); }
  if (body === "too-large") return Response.json({ error: "Request is too large." }, { status: 413 });
  if (!body) return Response.json({ error: "Send a valid JSON object." }, { status: 400 });
  const validationError = validateCareerPlanInput(workflow, body);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });
  if (!process.env.TINYFISH_API_KEY) return Response.json({ error: "Live research needs a server-side TINYFISH_API_KEY." }, { status: 503 });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      const emit = (name, data) => {
        if (!cancelled) controller.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      void runCareerPlanResearch(workflow, body, emit, abort.signal)
        .catch((error) => emit("error", { message: error.name === "TimeoutError" ? "Research timed out. Try again." : error.message || "Live research failed." }))
        .finally(() => { if (!cancelled) controller.close(); });
    },
    cancel() {
      cancelled = true;
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-content-type-options": "nosniff" } });
}
