import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function validServerSecret(request: Request) {
  const received = request.headers.get("x-waypoint-server-secret") ?? "";
  const expected = process.env.BILLING_SERVER_SECRET ?? "";
  if (!expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

http.route({
  path: "/waypoint/billing",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!validServerSecret(request)) return new Response("Unauthorized", { status: 401 });
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    let body;
    try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (body?.kind === "identity") return Response.json({ ownerId: identity.tokenIdentifier });
    if (body?.kind === "reservePlan" && typeof body.workspaceId === "string") {
      const reservationId = await ctx.runMutation(internal.billing.reservePlanForOwner, { ownerId: identity.tokenIdentifier, workspaceId: body.workspaceId });
      return Response.json({ reservationId });
    }
    if (body?.kind === "claimWorkflow" && typeof body.reservationId === "string" && typeof body.workflow === "string") {
      const claimed = await ctx.runMutation(internal.billing.claimWorkflow, {
        ownerId: identity.tokenIdentifier,
        reservationId: body.reservationId,
        workflow: body.workflow,
      });
      return Response.json({ claimed });
    }
    if (body?.kind === "recordWorkflow" && typeof body.reservationId === "string" && typeof body.workflow === "string" && typeof body.succeeded === "boolean") {
      const recorded = await ctx.runMutation(internal.billing.recordWorkflow, {
        ownerId: identity.tokenIdentifier,
        reservationId: body.reservationId,
        workflow: body.workflow,
        succeeded: body.succeeded,
      });
      return Response.json({ recorded });
    }
    if (body?.kind === "portalSubscription") {
      const subscription = await ctx.runQuery(internal.billing.portalSubscription, { ownerId: identity.tokenIdentifier });
      return Response.json(subscription);
    }
    if (body?.kind === "deleteAccountData") {
      return Response.json(await ctx.runMutation(internal.accounts.deleteAccountData, { ownerId: identity.tokenIdentifier }));
    }
    return new Response("Unknown billing operation", { status: 400 });
  }),
});

http.route({
  path: "/waypoint/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!validServerSecret(request)) return new Response("Unauthorized", { status: 401 });
    let body;
    try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (typeof body?.eventKey !== "string" || typeof body?.eventName !== "string" || !body.payload) return new Response("Invalid webhook event", { status: 400 });
    const result = await ctx.runMutation(internal.billing.processWebhook, body);
    return Response.json(result);
  }),
});

export default http;
