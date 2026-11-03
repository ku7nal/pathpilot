import { mutation, query } from "./_generated/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

type WorkspaceContext = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;
const MAX_WORKSPACES = 50;
const MAX_DOCUMENT_BYTES = 750_000;
const MAX_PROGRESS_ITEMS = 1_000;

function validateSize(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) throw new Error("Workspace data is too large to save.");
}

async function identity(ctx: WorkspaceContext) {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new Error("Unauthenticated");
  return user.tokenIdentifier;
}

async function ownedWorkspace(ctx: WorkspaceContext, id: Id<"workspaces">, ownerId: string): Promise<Doc<"workspaces">> {
  const workspace = await ctx.db.get(id);
  if (!workspace || workspace.ownerId !== ownerId) throw new Error("Workspace not found");
  return workspace;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await identity(ctx);
    const workspaces = await ctx.db.query("workspaces").withIndex("by_owner_updated", (q) => q.eq("ownerId", ownerId)).order("desc").take(MAX_WORKSPACES);
    return workspaces.map(({ _id, goal, targetRole, updatedAt }) => ({ _id, goal, targetRole, updatedAt }));
  },
});

export const get = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, { id }) => {
    const ownerId = await identity(ctx);
    return ownedWorkspace(ctx, id, ownerId);
  },
});

export const create = mutation({
  args: { goal: v.string() },
  handler: async (ctx, { goal }) => {
    const ownerId = await identity(ctx);
    const cleanedGoal = goal.trim();
    if (cleanedGoal.length < 3 || cleanedGoal.length > 240) throw new Error("Enter a goal between 3 and 240 characters.");
    const counter = await ctx.db.query("workspaceCounts").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    if ((counter?.count ?? 0) >= MAX_WORKSPACES) throw new Error("You can have up to 50 workspaces.");
    const now = Date.now();
    const id = await ctx.db.insert("workspaces", {
      ownerId, goal: cleanedGoal, targetRole: "", scout: null, plan: null,
      savedResources: [], completedMilestones: [], createdAt: now, updatedAt: now,
    });
    if (counter) await ctx.db.patch(counter._id, { count: counter.count + 1 });
    else await ctx.db.insert("workspaceCounts", { ownerId, count: 1 });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("workspaces"),
    goal: v.optional(v.string()),
    targetRole: v.optional(v.string()),
    scout: v.optional(v.any()),
    plan: v.optional(v.any()),
    savedResources: v.optional(v.array(v.string())),
    completedMilestones: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...changes }) => {
    const ownerId = await identity(ctx);
    const workspace = await ownedWorkspace(ctx, id, ownerId);
    if (changes.goal !== undefined && (changes.goal.trim().length < 3 || changes.goal.trim().length > 240)) throw new Error("Enter a goal between 3 and 240 characters.");
    if (changes.targetRole !== undefined && changes.targetRole.length > 160) throw new Error("Target role is too long.");
    for (const items of [changes.savedResources, changes.completedMilestones]) {
      if (items && (items.length > MAX_PROGRESS_ITEMS || items.some((item) => item.length > 2_000))) throw new Error("Workspace progress is too large.");
    }
    validateSize({ ...workspace, ...changes });
    await ctx.db.patch(id, { ...changes, ...(changes.goal === undefined ? {} : { goal: changes.goal.trim() }), updatedAt: Date.now() });
    return workspace._id;
  },
});
