async function clerkAuth() {
  const { auth } = await import("@clerk/nextjs/server");
  return auth();
}

export async function clerkUserId() {
  return (await clerkAuth()).userId;
}

export async function clerkConvexToken() {
  return (await clerkAuth()).getToken({ template: "convex" });
}
