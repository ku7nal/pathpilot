import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  workspaces: defineTable({
    ownerId: v.string(),
    goal: v.string(),
    targetRole: v.string(),
    scout: v.any(),
    plan: v.any(),
    savedResources: v.array(v.string()),
    completedMilestones: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner_updated", ["ownerId", "updatedAt"]),
  workspaceCounts: defineTable({ ownerId: v.string(), count: v.number() }).index("by_owner", ["ownerId"]),
});
