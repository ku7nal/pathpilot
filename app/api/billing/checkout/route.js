import { billingRequest } from "../../../../lib/billing-backend.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (!session.userId) return Response.json({ error: "Sign in to choose a plan." }, { status: 401 });
  const { tier } = await request.json().catch(() => ({}));
  if (tier !== "starter" && tier !== "pro") return Response.json({ error: "Choose Starter or Pro." }, { status: 400 });
  const variantId = tier === "starter" ? process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID : process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
  if (!variantId || !process.env.LEMON_SQUEEZY_STORE_ID || !process.env.LEMON_SQUEEZY_API_KEY) {
    return Response.json({ error: "Lemon Squeezy billing is not configured." }, { status: 503 });
  }
  try {
    const token = await session.getToken({ template: "convex" });
    const { ownerId } = await billingRequest("billing", { kind: "identity" }, token);
    const existing = await billingRequest("billing", { kind: "portalSubscription" }, token);
    const cancelledAndEnded = existing?.status === "cancelled" && existing.endsAt && Date.parse(existing.endsAt) <= Date.now();
    if (existing?.subscriptionId && !["expired"].includes(existing.status) && !cancelledAndEnded) {
      return Response.json({ error: "Manage or change your existing subscription through the customer portal." }, { status: 409 });
    }
    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`, accept: "application/vnd.api+json", "content-type": "application/vnd.api+json" },
      body: JSON.stringify({ data: { type: "checkouts", attributes: { checkout_options: { skip_trial: true }, checkout_data: { custom: { owner_id: ownerId } } }, relationships: { store: { data: { type: "stores", id: process.env.LEMON_SQUEEZY_STORE_ID } }, variant: { data: { type: "variants", id: variantId } } } } }),
    });
    const checkout = await response.json();
    const url = checkout?.data?.attributes?.url;
    if (!response.ok || typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("Lemon Squeezy could not create checkout.");
    return Response.json({ url });
  } catch (error) {
    return Response.json({ error: error.message || "Could not start checkout." }, { status: 502 });
  }
}
