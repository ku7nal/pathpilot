/// <reference types="vite/client" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { POST as checkout } from "../app/api/billing/checkout/route.js";
import { POST as scout } from "../app/api/job-scout/route.js";
import { POST as deleteAccount } from "../app/api/account/delete/route.js";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const realFetch = globalThis.fetch;

describe("SaaS acceptance flow", () => {
  beforeEach(() => {
    process.env.BILLING_SERVER_SECRET = "acceptance-secret";
    process.env.LEMON_SQUEEZY_API_KEY = "lemon-test-key";
    process.env.LEMON_SQUEEZY_STORE_ID = "store-test";
    process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID = "variant-starter";
    process.env.LEMON_SQUEEZY_PRO_VARIANT_ID = "variant-pro";
    process.env.TINYFISH_API_KEY = "tinyfish-test-key";
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  it("researches and saves findings, applies a checkout webhook, then removes the account", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "learner", tokenIdentifier: "clerk|learner" });
    const workspaceId = await learner.mutation(api.workspaces.create, { goal: "Become a frontend developer" });
    const session = async () => ({ userId: "user_learner", getToken: async () => "convex-token" });

    globalThis.fetch = async () => Response.json({ data: { attributes: { url: "https://waypoint.lemonsqueezy.com/checkout/test" } } });
    const checkoutBilling = async (_path: string, body: { kind: string }) => {
      if (body.kind === "identity") return { ownerId: "clerk|learner" };
      return t.query(internal.billing.portalSubscription, { ownerId: "clerk|learner" });
    };
    const checkoutResponse = await checkout(new Request("https://waypoint.example/api/billing/checkout", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: "starter" }),
    }), {}, session as never, checkoutBilling);
    assert.equal(checkoutResponse.status, 200);
    assert.match((await checkoutResponse.json()).url, /lemonsqueezy\.com\/checkout/);

    await t.mutation(internal.billing.processWebhook, {
      eventKey: "checkout-confirmed", eventName: "subscription_created",
      payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: "subscription-1", attributes: { store_id: "store-test", variant_id: "variant-starter", status: "active", updated_at: "2026-11-03T12:00:00Z" } } },
    });
    assert.equal((await learner.query(api.billing.getCurrentUsage, {})).tier, "starter");

    const reservationId = await learner.mutation(api.billing.reservePlan, { workspaceId });
    const researchBilling = async (_path: string, body: { kind: string; reservationId: string; workflow: string; succeeded: boolean }) => {
      if (body.kind === "claimWorkflow") return { claimed: await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId: body.reservationId as never, workflow: body.workflow }) };
      if (body.kind === "recordWorkflow") return { recorded: await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId: body.reservationId as never, workflow: body.workflow, succeeded: body.succeeded }) };
      return {};
    };
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "api.search.tinyfish.ai") return Response.json({ results: [{ url: "https://boards.greenhouse.io/acme/jobs/1", site_name: "Greenhouse" }] });
      return new Response(`data: ${JSON.stringify({ type: "COMPLETE", status: "COMPLETED", result: { jobs: [{ title: "Frontend Engineer", company: "Acme", skills: ["React"], application_url: "https://boards.greenhouse.io/acme/jobs/2", is_open: true }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    };
    const scoutResponse = await scout(new Request("https://waypoint.example/api/job-scout", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: "Become a frontend developer", reservationId }),
    }), {}, async () => "user_learner", researchBilling, async () => "convex-token");
    assert.equal(scoutResponse.status, 200);
    const scoutEvents = (await scoutResponse.text()).split(/\r?\n\r?\n/).filter(Boolean).map((event) => JSON.parse(event.split("\n").find((line) => line.startsWith("data:"))!.slice(5)));
    const findings = scoutEvents.find((event) => event.jobs)?.jobs;
    assert.equal(findings[0].company, "Acme");
    await learner.mutation(api.workspaces.update, { id: workspaceId, targetRole: "Frontend Developer", scout: { jobs: findings } });
    const saved = await learner.query(api.workspaces.get, { id: workspaceId });
    assert.equal(saved.scout.jobs[0].sourceUrl, "https://boards.greenhouse.io/acme/jobs/1");

    for (const workflow of ["learning-roadmap", "project-scout", "opportunity-scout"]) {
      await t.mutation(internal.billing.claimWorkflow, { ownerId: "clerk|learner", reservationId, workflow });
      await t.mutation(internal.billing.recordWorkflow, { ownerId: "clerk|learner", reservationId, workflow, succeeded: true });
    }
    assert.equal((await learner.query(api.billing.getCurrentUsage, {})).used, 1);
    await t.mutation(internal.billing.processWebhook, {
      eventKey: "subscription-cancelled", eventName: "subscription_expired",
      payload: { meta: { custom_data: { owner_id: "clerk|learner" } }, data: { id: "subscription-1", attributes: { store_id: "store-test", variant_id: "variant-starter", status: "expired", updated_at: "2026-11-03T12:01:00Z" } } },
    });

    const deleteBilling = async (_path: string, body: { kind: string }) => body.kind === "deleteAccountData"
      ? t.mutation(internal.accounts.deleteAccountData, { ownerId: "clerk|learner" })
      : {};
    const clerkDeletes: string[] = [];
    const deletion = await deleteAccount(new Request("https://waypoint.example/api/account/delete", {
      method: "POST", headers: { origin: "https://waypoint.example", "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }),
    }), {}, session as never, deleteBilling, async (userId) => { clerkDeletes.push(userId); });
    assert.equal(deletion.status, 200);
    assert.deepEqual(clerkDeletes, ["user_learner"]);
    assert.deepEqual(await t.run(async (ctx) => ({
      workspaces: await ctx.db.query("workspaces").collect(),
      workspaceCounts: await ctx.db.query("workspaceCounts").collect(),
    })), { workspaces: [], workspaceCounts: [] });
  });
});
