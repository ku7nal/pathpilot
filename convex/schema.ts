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
  billingAccounts: defineTable({
    ownerId: v.string(),
    tier: v.union(v.literal("starter"), v.literal("pro")),
    status: v.string(),
    customerId: v.string(),
    subscriptionId: v.string(),
    variantId: v.string(),
    renewsAt: v.optional(v.string()),
    endsAt: v.optional(v.string()),
    providerUpdatedAt: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]).index("by_subscription", ["subscriptionId"]),
  billingUsage: defineTable({ ownerId: v.string(), month: v.string(), used: v.number(), reserved: v.number() }).index("by_owner_month", ["ownerId", "month"]),
  planReservations: defineTable({
    ownerId: v.string(),
    workspaceId: v.id("workspaces"),
    month: v.string(),
    status: v.union(v.literal("reserved"), v.literal("completed"), v.literal("released")),
    startedWorkflows: v.array(v.string()),
    completedWorkflows: v.array(v.string()),
    failedWorkflows: v.array(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    settledAt: v.optional(v.number()),
  }).index("by_owner_month", ["ownerId", "month"]),
  billingWebhookEvents: defineTable({ eventKey: v.string(), eventName: v.string(), resourceId: v.string(), receivedAt: v.number(), ignored: v.boolean() }).index("by_event_key", ["eventKey"]),
});
