/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

describe("billing allowances", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    process.env.LEMON_SQUEEZY_STORE_ID = "store-1";
    process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID = "variant-5";
    process.env.LEMON_SQUEEZY_PRO_VARIANT_ID = "variant-20";
  });

  it("reserves atomically, charges only complete plans, and releases infrastructure failures", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    const workspaceId = await learner.mutation(api.workspaces.create, { goal: "Learn frontend development" });
    const results = await Promise.allSettled([
      learner.mutation(api.billing.reservePlan, { workspaceId }),
      learner.mutation(api.billing.reservePlan, { workspaceId }),
    ]);
    const reservationId = results.find((item) => item.status === "fulfilled")?.value;
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "free", limit: 1, remaining: 0, reserved: 1 });
    const workflows = ["job-scout", "learning-roadmap", "project-scout", "opportunity-scout"];
    for (const workflow of workflows) expect(await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId: reservationId!, workflow })).toBe(true);
    expect(await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId: reservationId!, workflow: "job-scout" })).toBe(false);
    await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId: reservationId!, workflow: "job-scout", succeeded: false });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ used: 0, reserved: 1, remaining: 0 });
    for (const workflow of workflows.slice(1)) await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId: reservationId!, workflow, succeeded: true });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ used: 0, reserved: 0, remaining: 1 });

    const refreshed = await learner.mutation(api.billing.reservePlan, { workspaceId });
    for (const workflow of ["job-scout", "learning-roadmap", "project-scout", "opportunity-scout"]) {
      expect(await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId: refreshed, workflow })).toBe(true);
      await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId: refreshed, workflow, succeeded: true });
    }
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ used: 1, reserved: 0, remaining: 0 });
    await expect(learner.mutation(api.billing.reservePlan, { workspaceId })).rejects.toThrow("limit reached");
  });

  it("uses UTC monthly limits and subscription lifecycle events", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    const workspaceId = await learner.mutation(api.workspaces.create, { goal: "Learn frontend development" });
    const apply = (eventKey: string, eventName: string, attributes: Record<string, unknown>, id = "sub-1") =>
      t.mutation(internal.billing.processWebhook, { eventKey, eventName, payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id, relationships: { subscription: { data: { id } } }, attributes: { store_id: "store-1", customer_id: 10, variant_id: "variant-5", status: "active", ...attributes } } } });

    await apply("created", "subscription_created", { updated_at: "2026-11-01T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "starter", limit: 5 });
    await apply("cancel", "subscription_cancelled", { status: "cancelled", ends_at: "2026-11-30T23:59:59Z", updated_at: "2026-11-02T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "starter" });
    await apply("resume", "subscription_resumed", { status: "active", ends_at: null, updated_at: "2026-11-03T00:00:00Z" });
    await apply("stale-cancel", "subscription_cancelled", { status: "cancelled", ends_at: "2026-11-30T23:59:59Z", updated_at: "2026-11-02T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "starter", subscriptionStatus: "active" });
    await apply("failed", "subscription_payment_failed", { status: "past_due", updated_at: "2026-11-04T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "free", limit: 1 });
    await apply("recovered", "subscription_payment_recovered", { updated_at: "2026-11-05T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "starter", limit: 5 });
    await apply("expired", "subscription_expired", { status: "expired", updated_at: "2026-11-06T00:00:00Z" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "free", limit: 1 });

    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    const nextMonth = await learner.query(api.billing.getCurrentUsage, {});
    expect(nextMonth).toMatchObject({ used: 0, reserved: 0, resetsAt: Date.UTC(2027, 0, 1) });
    await learner.mutation(api.billing.reservePlan, { workspaceId });
  });

  it("enforces Starter and Pro reservation caps", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    const workspaceId = await learner.mutation(api.workspaces.create, { goal: "Learn frontend development" });
    for (const [tier, variantId, limit] of [["starter", "variant-5", 5], ["pro", "variant-20", 20]] as const) {
      await t.mutation(internal.billing.processWebhook, {
        eventKey: `set-${tier}`, eventName: "subscription_created",
        payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: `sub-${tier}`, attributes: { store_id: "store-1", variant_id: variantId, status: "active" } } },
      });
      for (let count = 0; count < limit; count += 1) await learner.mutation(api.billing.reservePlan, { workspaceId });
      expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier, limit, remaining: 0, reserved: limit });
      await expect(learner.mutation(api.billing.reservePlan, { workspaceId })).rejects.toThrow("limit reached");
      for (const reservation of await t.run(async (ctx) => ctx.db.query("planReservations").collect())) {
        if (reservation.status !== "reserved") continue;
        await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId: reservation._id, workflow: "job-scout" });
        await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId: reservation._id, workflow: "job-scout", succeeded: false });
      }
    }

    const trial = await t.mutation(internal.billing.processWebhook, {
      eventKey: "trial", eventName: "subscription_created",
      payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: "trial-sub", attributes: { store_id: "store-1", variant_id: "variant-5", status: "on_trial" } } },
    });
    expect(trial.ignored).toBe(false);
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "free", limit: 1 });
  });

  it("ignores duplicate, stale, and unknown-variant webhook deliveries", async () => {
    const t = convexTest(schema, modules);
    const payload = { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: "sub-1", attributes: { store_id: "store-1", variant_id: "variant-5", status: "active", updated_at: "2026-11-02T00:00:00Z" } } };
    await t.mutation(internal.billing.processWebhook, { eventKey: "one", eventName: "subscription_created", payload });
    expect(await t.mutation(internal.billing.processWebhook, { eventKey: "one", eventName: "subscription_created", payload })).toMatchObject({ duplicate: true });
    await t.mutation(internal.billing.processWebhook, { eventKey: "unknown", eventName: "subscription_created", payload: { ...payload, data: { ...payload.data, attributes: { ...payload.data.attributes, variant_id: "bad" } } } });
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    expect(await learner.query(api.billing.getCurrentUsage, {})).toMatchObject({ tier: "starter" });
  });
});
