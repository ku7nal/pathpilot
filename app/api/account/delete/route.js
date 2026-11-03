import { billingRequest } from "../../../../lib/billing-backend.mjs";
import { clerkSession } from "../../../../lib/clerk-auth.mjs";

export const runtime = "nodejs";

async function deleteClerkUser(userId) {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  await client.users.deleteUser(userId);
}

export async function POST(request, _context, getSession = clerkSession, billing = billingRequest, removeClerkUser = deleteClerkUser) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Use the Waypoint page to delete your account." }, { status: 403 });
  const session = await getSession();
  if (!session.userId) return Response.json({ error: "Sign in to delete your account." }, { status: 401 });

  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Confirm account deletion." }, { status: 400 });
  let body = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_024) { await reader.cancel(); return Response.json({ error: "Request is too large." }, { status: 413 }); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    if (JSON.parse(body)?.confirm !== "DELETE") return Response.json({ error: "Type DELETE to confirm account deletion." }, { status: 400 });
  } catch { return Response.json({ error: "Send a valid deletion confirmation." }, { status: 400 }); }

  try {
    const token = await session.getToken({ template: "convex" });
    const result = await billing("billing", { kind: "deleteAccountData" }, token);
    if (!result.deleted) return Response.json({ error: "Cancel your active subscription through Manage subscription before deleting your account.", needsCancellation: true }, { status: 409 });
  } catch (error) {
    console.error("Account data deletion failed", { error: error.message });
    return Response.json({ error: "Waypoint could not remove your account data. Try again shortly." }, { status: 503 });
  }

  try {
    await removeClerkUser(session.userId);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Clerk account deletion failed after Convex cleanup", { error: error.message });
    return Response.json({ error: "Your Waypoint data was removed, but account deletion did not finish. Retry or contact support.", dataRemoved: true }, { status: 502 });
  }
}
