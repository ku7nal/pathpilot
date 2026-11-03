import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertAccountExists, isDeletedAccount } from "./account-key";
import type { DataModel, Id } from "./_generated/dataModel";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { v } from "convex/values";

type BillingContext = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;
const WORKFLOWS = ["job-scout", "learning-roadmap", "project-scout", "opportunity-scout"] as const;
type Workflow = typeof WORKFLOWS[number];

function monthAt(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function nextMonthAt(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function entitlement(account: { tier: "starter" | "pro"; status: string; endsAt?: string } | null, now: number) {
  if (!account) return "free" as const;
  if (account.status === "active") return account.tier;
  if (account.status === "cancelled" && account.endsAt && Date.parse(account.endsAt) > now) return account.tier;
  return "free" as const;
}

function limitFor(tier: "free" | "starter" | "pro") {
  return tier === "pro" ? 20 : tier === "starter" ? 5 : 1;
}

async function ownerId(ctx: BillingContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  await assertAccountExists(ctx, identity.tokenIdentifier);
  return identity.tokenIdentifier;
}

async function accountFor(ctx: BillingContext, owner: string) {
  return ctx.db.query("billingAccounts").withIndex("by_owner", (q) => q.eq("ownerId", owner)).unique();
}

async function usageFor(ctx: BillingContext, owner: string, month: string) {
  return ctx.db.query("billingUsage").withIndex("by_owner_month", (q) => q.eq("ownerId", owner).eq("month", month)).unique();
}

export const getCurrentUsage = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ownerId(ctx);
    const now = Date.now();
    const month = monthAt(now);
    const [account, usage] = await Promise.all([accountFor(ctx, owner), usageFor(ctx, owner, month)]);
    const tier = entitlement(account, now);
    const limit = limitFor(tier);
    const used = usage?.used ?? 0;
    const reserved = usage?.reserved ?? 0;
    return {
      tier,
      subscriptionStatus: account?.status ?? null,
      renewsAt: account?.renewsAt ?? null,
      endsAt: account?.endsAt ?? null,
      used,
      reserved,
      limit,
      remaining: Math.max(0, limit - used - reserved),
      resetsAt: nextMonthAt(now),
    };
  },
});

async function reserve(ctx: GenericMutationCtx<DataModel>, owner: string, workspaceId: Id<"workspaces">) {
    await assertAccountExists(ctx, owner);
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace || workspace.ownerId !== owner) throw new Error("Workspace not found");
    const now = Date.now();
    const month = monthAt(now);
    const account = await accountFor(ctx, owner);
    const tier = entitlement(account, now);
    const limit = limitFor(tier);
    const usage = await usageFor(ctx, owner, month);
    const used = usage?.used ?? 0;
    const reserved = usage?.reserved ?? 0;
    if (used + reserved >= limit) throw new Error(`Monthly ${tier} plan limit reached. Upgrade or try again next month.`);
    if (usage) await ctx.db.patch(usage._id, { reserved: reserved + 1 });
    else await ctx.db.insert("billingUsage", { ownerId: owner, month, used: 0, reserved: 1 });
    const expiresAt = now + 30 * 60_000;
    const reservationId = await ctx.db.insert("planReservations", {
      ownerId: owner, workspaceId, month, status: "reserved", startedWorkflows: [], completedWorkflows: [], failedWorkflows: [], createdAt: now, expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.billing.releaseExpiredReservation, { reservationId });
    return reservationId;
}

export const reservePlan = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => reserve(ctx, await ownerId(ctx), workspaceId),
});

export const reservePlanForOwner = internalMutation({
  args: { ownerId: v.string(), workspaceId: v.id("workspaces") },
  handler: async (ctx, { ownerId: owner, workspaceId }) => reserve(ctx, owner, workspaceId),
});

export const claimWorkflow = internalMutation({
  args: { ownerId: v.string(), reservationId: v.id("planReservations"), workflow: v.string() },
  handler: async (ctx, { ownerId: owner, reservationId, workflow }) => {
    if (!WORKFLOWS.includes(workflow as Workflow)) throw new Error("Unknown research workflow");
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.ownerId !== owner || reservation.status !== "reserved") return false;
    if (reservation.expiresAt <= Date.now()) {
      await releaseReservation(ctx, reservation, "released");
      return false;
    }
    if (reservation.startedWorkflows.includes(workflow)) return false;
    await ctx.db.patch(reservationId, { startedWorkflows: [...reservation.startedWorkflows, workflow] });
    return true;
  },
});

async function releaseReservation(ctx: GenericMutationCtx<DataModel>, reservation: { _id: Id<"planReservations">; ownerId: string; month: string; status: string; completedWorkflows?: string[]; failedWorkflows?: string[] }, status: "released") {
  if (reservation.status !== "reserved") return;
  const usage = await usageFor(ctx, reservation.ownerId, reservation.month);
  if (usage) await ctx.db.patch(usage._id, { reserved: Math.max(0, usage.reserved - 1) });
  await ctx.db.patch(reservation._id, { status, settledAt: Date.now() });
}

export const recordWorkflow = internalMutation({
  args: { ownerId: v.string(), reservationId: v.id("planReservations"), workflow: v.string(), succeeded: v.boolean() },
  handler: async (ctx, { ownerId: owner, reservationId, workflow, succeeded }) => {
    if (!WORKFLOWS.includes(workflow as Workflow)) throw new Error("Unknown research workflow");
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.ownerId !== owner || reservation.status !== "reserved") return false;
    if (reservation.expiresAt <= Date.now()) {
      await releaseReservation(ctx, reservation, "released");
      return false;
    }
    if (!succeeded) {
      if (!reservation.startedWorkflows.includes(workflow)) return false;
      if (reservation.completedWorkflows.includes(workflow) || reservation.failedWorkflows.includes(workflow)) return false;
      const failedWorkflows = [...reservation.failedWorkflows, workflow];
      if ([...reservation.completedWorkflows, ...failedWorkflows].length === reservation.startedWorkflows.length) {
        await releaseReservation(ctx, { ...reservation, failedWorkflows }, "released");
      } else {
        await ctx.db.patch(reservationId, { failedWorkflows });
      }
      return false;
    }
    if (!reservation.startedWorkflows.includes(workflow)) return false;
    if (reservation.completedWorkflows.includes(workflow) || reservation.failedWorkflows.includes(workflow)) return true;
    const completedWorkflows = [...reservation.completedWorkflows, workflow];
    if ([...completedWorkflows, ...reservation.failedWorkflows].length === reservation.startedWorkflows.length) {
      if (reservation.failedWorkflows.length) {
        await releaseReservation(ctx, { ...reservation, completedWorkflows }, "released");
        return true;
      }
    }
    if (completedWorkflows.length === WORKFLOWS.length) {
      const usage = await usageFor(ctx, owner, reservation.month);
      if (!usage) throw new Error("Monthly usage record is missing");
      await ctx.db.patch(usage._id, { reserved: Math.max(0, usage.reserved - 1), used: usage.used + 1 });
      await ctx.db.patch(reservationId, { completedWorkflows, status: "completed", settledAt: Date.now() });
    } else {
      await ctx.db.patch(reservationId, { completedWorkflows });
    }
    return true;
  },
});

export const releaseExpiredReservation = internalMutation({
  args: { reservationId: v.id("planReservations") },
  handler: async (ctx, { reservationId }) => {
    const reservation = await ctx.db.get(reservationId);
    if (reservation && reservation.expiresAt <= Date.now()) await releaseReservation(ctx, reservation, "released");
  },
});

export const portalSubscription = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId: owner }) => {
    const account = await accountFor(ctx, owner);
    return account ? { subscriptionId: account.subscriptionId, status: account.status, endsAt: account.endsAt } : null;
  },
});

const subscriptionEvents = new Set([
  "subscription_created", "subscription_updated", "subscription_cancelled", "subscription_resumed",
  "subscription_expired", "subscription_paused", "subscription_unpaused", "subscription_plan_changed",
]);
const paymentEvents = new Set(["subscription_payment_failed", "subscription_payment_recovered", "subscription_payment_success"]);

function variantTier(variantId: string) {
  if (variantId === process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID) return "starter" as const;
  if (variantId === process.env.LEMON_SQUEEZY_PRO_VARIANT_ID) return "pro" as const;
  return null;
}

export const processWebhook = internalMutation({
  args: { eventKey: v.string(), eventName: v.string(), payload: v.any() },
  handler: async (ctx, { eventKey, eventName, payload }) => {
    const duplicate = await ctx.db.query("billingWebhookEvents").withIndex("by_event_key", (q) => q.eq("eventKey", eventKey)).unique();
    if (duplicate) return { duplicate: true };
    const data = payload?.data;
    const attrs = data?.attributes;
    const resourceId = typeof data?.id === "string" ? data.id : "";
    const relatedSubscriptionId = payload?.data?.relationships?.subscription?.data?.id;
    const subscriptionId = subscriptionEvents.has(eventName)
      ? resourceId
      : typeof relatedSubscriptionId === "string" ? relatedSubscriptionId
      : typeof attrs?.subscription_id === "number" || typeof attrs?.subscription_id === "string" ? String(attrs.subscription_id) : undefined;
    let ignored = true;
    if (attrs && String(attrs.store_id) === process.env.LEMON_SQUEEZY_STORE_ID) {
      if (subscriptionEvents.has(eventName)) {
        const existingBySubscription = resourceId ? await ctx.db.query("billingAccounts").withIndex("by_subscription", (q) => q.eq("subscriptionId", resourceId)).unique() : null;
        const customOwner = payload?.meta?.custom_data?.owner_id;
        const owner = typeof customOwner === "string" ? customOwner : existingBySubscription?.ownerId;
        const mappedTier = typeof attrs.variant_id === "number" || typeof attrs.variant_id === "string" ? variantTier(String(attrs.variant_id)) : null;
        const deleted = owner ? await isDeletedAccount(ctx, owner) : false;
        if (owner && !deleted && (mappedTier || existingBySubscription)) {
          const current = await accountFor(ctx, owner);
          const providerUpdatedAt = typeof attrs.updated_at === "string" ? attrs.updated_at : undefined;
          if (!providerUpdatedAt || !current?.providerUpdatedAt || Date.parse(providerUpdatedAt) >= Date.parse(current.providerUpdatedAt)) {
            const patch = {
              ownerId: owner,
              tier: mappedTier ?? current!.tier,
              status: typeof attrs.status === "string" ? attrs.status : eventName.replace("subscription_", ""),
              customerId: String(attrs.customer_id ?? current?.customerId ?? ""),
              subscriptionId: resourceId,
              variantId: String(attrs.variant_id ?? current?.variantId ?? ""),
              renewsAt: typeof attrs.renews_at === "string" ? attrs.renews_at : undefined,
              endsAt: typeof attrs.ends_at === "string" ? attrs.ends_at : undefined,
              providerUpdatedAt,
              updatedAt: Date.now(),
            };
            if (current) await ctx.db.patch(current._id, patch);
            else await ctx.db.insert("billingAccounts", patch);
          }
          ignored = false;
        }
      } else if (paymentEvents.has(eventName)) {
        const current = subscriptionId ? await ctx.db.query("billingAccounts").withIndex("by_subscription", (q) => q.eq("subscriptionId", subscriptionId)).unique() : null;
        if (current) {
          const providerUpdatedAt = typeof attrs.updated_at === "string" ? attrs.updated_at : typeof attrs.created_at === "string" ? attrs.created_at : undefined;
          if (!providerUpdatedAt || !current.providerUpdatedAt || Date.parse(providerUpdatedAt) >= Date.parse(current.providerUpdatedAt)) {
            const status = eventName === "subscription_payment_failed" ? "past_due" : "active";
            await ctx.db.patch(current._id, { status, ...(providerUpdatedAt ? { providerUpdatedAt } : {}), updatedAt: Date.now() });
          }
          ignored = false;
        }
      }
    }
    await ctx.db.insert("billingWebhookEvents", { eventKey, eventName, resourceId: ignored ? "" : resourceId, ...(!ignored && subscriptionId ? { subscriptionId } : {}), receivedAt: Date.now(), ignored });
    return { duplicate: false, ignored };
  },
});
