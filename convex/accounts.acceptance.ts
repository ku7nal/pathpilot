/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

describe("account deletion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    process.env.BILLING_SERVER_SECRET = "test-only-long-random-secret";
    process.env.LEMON_SQUEEZY_STORE_ID = "store-1";
    process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID = "variant-5";
    process.env.LEMON_SQUEEZY_PRO_VARIANT_ID = "variant-20";
  });

  it("requires cancellation, removes account data, and ignores later billing webhooks", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    const workspaceId = await learner.mutation(api.workspaces.create, { goal: "Learn frontend development" });
    await learner.mutation(api.billing.reservePlan, { workspaceId });
    await t.run(async (ctx) => {
      await ctx.db.insert("billingWebhookEvents", { eventKey: "legacy-event", eventName: "subscription_created", resourceId: "sub-1", receivedAt: Date.now(), ignored: false });
    });
    const subscription = (eventKey: string, status: string, updatedAt: string) => t.mutation(internal.billing.processWebhook, {
      eventKey,
      eventName: status === "active" ? "subscription_created" : "subscription_cancelled",
      payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: "sub-1", attributes: { store_id: "store-1", variant_id: "variant-5", status, updated_at: updatedAt, ends_at: status === "cancelled" ? "2026-11-30T23:59:59Z" : null } } },
    });
    await subscription("active", "active", "2026-11-01T00:00:00Z");
    expect(await t.mutation(internal.accounts.deleteAccountData, { ownerId: "clerk|learner" })).toEqual({ deleted: false });
    expect(await learner.query(api.workspaces.list)).toHaveLength(1);

    await subscription("cancelled", "cancelled", "2026-11-02T00:00:00Z");
    expect(await t.mutation(internal.accounts.deleteAccountData, { ownerId: "clerk|learner" })).toEqual({ deleted: true });
    await expect(learner.query(api.workspaces.list)).rejects.toThrow("account has been deleted");
    await expect(learner.query(api.billing.getCurrentUsage, {})).rejects.toThrow("account has been deleted");
    await expect(learner.mutation(api.workspaces.create, { goal: "Try to return" })).rejects.toThrow("account has been deleted");
    await subscription("late-retry", "active", "2026-11-03T00:00:00Z");

    const remaining = await t.run(async (ctx) => ({
      workspaces: await ctx.db.query("workspaces").collect(),
      usage: await ctx.db.query("billingUsage").collect(),
      reservations: await ctx.db.query("planReservations").collect(),
      subscriptions: await ctx.db.query("billingAccounts").collect(),
      deletedAccounts: await ctx.db.query("deletedAccounts").collect(),
      webhookEvents: await ctx.db.query("billingWebhookEvents").collect(),
    }));
    expect(remaining).toMatchObject({ workspaces: [], usage: [], reservations: [], subscriptions: [] });
    expect(remaining.deletedAccounts).toHaveLength(1);
    expect(remaining.deletedAccounts[0].ownerHash).not.toContain("clerk|learner");
    expect(remaining.webhookEvents.some((event) => event.subscriptionId === "sub-1" || event.resourceId === "sub-1")).toBe(false);
    await expect(learner.query(api.billing.getCurrentUsage, {})).rejects.toThrow("account has been deleted");
  });
});
