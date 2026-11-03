import { billingRequest } from "../../../../lib/billing-backend.mjs";

export const runtime = "nodejs";

export async function POST() {
  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  if (!session.userId) return Response.json({ error: "Sign in to manage your plan." }, { status: 401 });
  try {
    const token = await session.getToken({ template: "convex" });
    const subscription = await billingRequest("billing", { kind: "portalSubscription" }, token);
    if (!subscription?.subscriptionId) return Response.json({ error: "No paid subscription is linked to this account." }, { status: 404 });
    const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscription.subscriptionId)}`, { headers: { authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`, accept: "application/vnd.api+json" } });
    const data = await response.json();
    const url = data?.data?.attributes?.urls?.customer_portal;
    if (!response.ok || typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("Lemon Squeezy could not open the customer portal.");
    return Response.json({ url });
  } catch (error) {
    return Response.json({ error: error.message || "Could not open customer portal." }, { status: 502 });
  }
}
