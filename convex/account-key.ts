import type { DataModel } from "./_generated/dataModel";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

type AccountContext = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

export async function accountOwnerHash(ownerId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isDeletedAccount(ctx: AccountContext, ownerId: string) {
  const ownerHash = await accountOwnerHash(ownerId);
  return Boolean(await ctx.db.query("deletedAccounts").withIndex("by_owner_hash", (q) => q.eq("ownerHash", ownerHash)).unique());
}

export async function assertAccountExists(ctx: AccountContext, ownerId: string) {
  if (await isDeletedAccount(ctx, ownerId)) throw new Error("This Waypoint account has been deleted.");
}
