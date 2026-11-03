import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/account/delete/route.js";

function request(body = { confirm: "DELETE" }, origin = "https://waypoint.example") {
  return new Request("https://waypoint.example/api/account/delete", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const session = async () => ({ userId: "user_1", getToken: async () => "clerk-token" });

test("requires a same-origin signed-in deletion confirmation", async () => {
  const fail = async () => assert.fail("Deletion dependencies should not run");
  assert.equal((await POST(request({}, "https://attacker.example"), {}, session, fail, fail)).status, 403);
  assert.equal((await POST(request({ confirm: "no" }), {}, session, fail, fail)).status, 400);
  assert.equal((await POST(request(), {}, async () => ({ userId: null }), fail, fail)).status, 401);
});

test("blocks active subscriptions before deleting any account", async () => {
  let clerkDeleted = false;
  const response = await POST(request(), {}, session, async (_path, body, token) => {
    assert.equal(body.kind, "deleteAccountData");
    assert.equal(token, "clerk-token");
    return { deleted: false };
  }, async () => { clerkDeleted = true; });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).needsCancellation, true);
  assert.equal(clerkDeleted, false);
});

test("removes Convex data before deleting the Clerk identity", async () => {
  const calls = [];
  const response = await POST(request(), {}, session, async () => { calls.push("convex"); return { deleted: true }; }, async (userId) => { calls.push(`clerk:${userId}`); });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["convex", "clerk:user_1"]);
});

test("reports a recoverable Clerk deletion failure after account data is removed", async () => {
  const response = await POST(request(), {}, session, async () => ({ deleted: true }), async () => { throw new Error("Clerk unavailable"); });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).dataRemoved, true);
});
