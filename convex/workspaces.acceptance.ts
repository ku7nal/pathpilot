/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

describe("workspaces", () => {
  it("persists findings and progress for their owner and rejects other accounts", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "user_alice", tokenIdentifier: "clerk|user_alice" });
    const id = await alice.mutation(api.workspaces.create, { goal: "Become a frontend developer" });

    await alice.mutation(api.workspaces.update, {
      id,
      targetRole: "Frontend Developer",
      scout: { jobs: [{ title: "Frontend Engineer", sourceUrl: "https://jobs.example/1" }] },
      plan: { roadmap: { phases: [{ title: "Web foundations" }] } },
      savedResources: ["https://developer.mozilla.org/"],
      completedMilestones: ["Portfolio project\u0000Build the UI"],
    });

    const signedBackIn = t.withIdentity({ subject: "user_alice", tokenIdentifier: "clerk|user_alice" });
    const saved = await signedBackIn.query(api.workspaces.get, { id });
    expect(saved.scout.jobs[0].sourceUrl).toBe("https://jobs.example/1");
    expect(saved.plan.roadmap.phases[0].title).toBe("Web foundations");
    expect(saved.savedResources).toEqual(["https://developer.mozilla.org/"]);
    expect(saved.completedMilestones).toEqual(["Portfolio project\u0000Build the UI"]);

    const bob = t.withIdentity({ subject: "user_bob", tokenIdentifier: "clerk|user_bob" });
    expect(await bob.query(api.workspaces.list)).toEqual([]);
    await expect(bob.query(api.workspaces.get, { id })).rejects.toThrow("Workspace not found");
    await expect(bob.mutation(api.workspaces.update, { id, goal: "Own this workspace" })).rejects.toThrow("Workspace not found");
    await expect(t.query(api.workspaces.list)).rejects.toThrow("Unauthenticated");
  });

  it("limits workspace count and stored document size", async () => {
    const t = convexTest(schema, modules);
    const learner = t.withIdentity({ subject: "user_limit", tokenIdentifier: "clerk|user_limit" });
    for (let index = 0; index < 50; index += 1) {
      await learner.mutation(api.workspaces.create, { goal: `Career goal ${index}` });
    }
    await expect(learner.mutation(api.workspaces.create, { goal: "One too many" })).rejects.toThrow("up to 50");

    const first = (await learner.query(api.workspaces.list))[0];
    await expect(learner.mutation(api.workspaces.update, { id: first._id, plan: { text: "x".repeat(800_000) } })).rejects.toThrow("too large");
  });
});
