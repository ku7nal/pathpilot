import { internalMutation } from "./_generated/server";
import { accountOwnerHash } from "./account-key";
import { v } from "convex/values";

const blockingSubscriptionStatuses = new Set(["active", "on_trial", "past_due", "paused", "unpaid"]);

export const deleteAccountData = internalMutation({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const billing = await ctx.db.query("billingAccounts").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    if (billing && blockingSubscriptionStatuses.has(billing.status)) return { deleted: false };

    const workspaceRows = await ctx.db.query("workspaces").withIndex("by_owner_updated", (q) => q.eq("ownerId", ownerId)).collect();
    for (const workspace of workspaceRows) await ctx.db.delete(workspace._id);
    const count = await ctx.db.query("workspaceCounts").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
    if (count) await ctx.db.delete(count._id);
    for (const row of await ctx.db.query("billingUsage").withIndex("by_owner_month", (q) => q.eq("ownerId", ownerId)).collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("planReservations").withIndex("by_owner_month", (q) => q.eq("ownerId", ownerId)).collect()) await ctx.db.delete(row._id);
    if (billing) {
      for (const event of await ctx.db.query("billingWebhookEvents").withIndex("by_subscription", (q) => q.eq("subscriptionId", billing.subscriptionId)).collect()) await ctx.db.delete(event._id);
      for (const event of await ctx.db.query("billingWebhookEvents").withIndex("by_resource", (q) => q.eq("resourceId", billing.subscriptionId)).collect()) await ctx.db.delete(event._id);
      await ctx.db.delete(billing._id);
    }

    const ownerHash = await accountOwnerHash(ownerId);
    const deleted = await ctx.db.query("deletedAccounts").withIndex("by_owner_hash", (q) => q.eq("ownerHash", ownerHash)).unique();
    if (!deleted) await ctx.db.insert("deletedAccounts", { ownerHash, deletedAt: Date.now() });
    return { deleted: true };
  },
});
