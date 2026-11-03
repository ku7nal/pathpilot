import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { POST } from "../app/api/billing/webhook/route.js";

const realFetch = globalThis.fetch;
const env = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ["NEXT_PUBLIC_CONVEX_URL", "BILLING_SERVER_SECRET", "LEMON_SQUEEZY_WEBHOOK_SECRET"]) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
});

function signedRequest(raw, signature, eventName = "subscription_created") {
  return new Request("https://waypoint.example/api/billing/webhook", {
    method: "POST",
    headers: { "x-signature": signature, "x-event-name": eventName },
    body: raw,
  });
}

test("rejects invalid webhook signatures without calling Convex", async () => {
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "webhook-secret";
  globalThis.fetch = async () => assert.fail("Invalid webhooks must not reach Convex");
  const response = await POST(signedRequest("{}", "0".repeat(64)));
  assert.equal(response.status, 401);
});

test("forwards a signed webhook with an idempotency fingerprint to Convex", async () => {
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = "webhook-secret";
  process.env.BILLING_SERVER_SECRET = "server-secret";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://abc.convex.cloud";
  const payload = { meta: { event_name: "subscription_created" }, data: { id: "sub-1", attributes: {} } };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.LEMON_SQUEEZY_WEBHOOK_SECRET).update(raw).digest("hex");
  let sent;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(input).href, "https://abc.convex.site/waypoint/webhook");
    assert.equal(new Headers(init.headers).get("x-waypoint-server-secret"), "server-secret");
    sent = JSON.parse(init.body);
    return Response.json({ duplicate: false });
  };
  const response = await POST(signedRequest(raw, signature));
  assert.equal(response.status, 200);
  assert.equal(sent.eventName, "subscription_created");
  assert.equal(sent.payload.data.id, "sub-1");
  assert.equal(sent.eventKey.length, 64);
});
