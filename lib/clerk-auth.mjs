export async function clerkSession() {
  const { auth } = await import("@clerk/nextjs/server");
  return auth();
}

export async function clerkUserId() {
  return (await clerkSession()).userId;
}

export async function clerkConvexToken() {
  return (await clerkSession()).getToken({ template: "convex" });
}
