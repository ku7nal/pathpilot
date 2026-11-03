import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST } from "../app/api/billing/checkout/route.js";

const realFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ["LEMON_SQUEEZY_API_KEY", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_STARTER_VARIANT_ID", "LEMON_SQUEEZY_PRO_VARIANT_ID"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function configure() {
  process.env.LEMON_SQUEEZY_API_KEY = "test-api-key";
  process.env.LEMON_SQUEEZY_STORE_ID = "store-test";
  process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID = "variant-starter";
  process.env.LEMON_SQUEEZY_PRO_VARIANT_ID = "variant-pro";
}

function request(tier = "starter") {
  return new Request("https://waypoint.example/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier }) });
}

const session = async () => ({ userId: "user_1", getToken: async () => "clerk-token" });

test("creates a no-trial hosted checkout with the trusted account identifier", async () => {
  configure();
  let payload;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.lemonsqueezy.com/v1/checkouts");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-api-key");
    payload = JSON.parse(init.body);
    return Response.json({ data: { attributes: { url: "https://example.lemonsqueezy.com/checkout/test" } } });
  };
  const billing = async (_path, body, token) => {
    assert.equal(token, "clerk-token");
    if (body.kind === "identity") return { ownerId: "clerk|user_1" };
    return null;
  };
  const response = await POST(request("pro"), {}, session, billing);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, "https://example.lemonsqueezy.com/checkout/test");
  assert.equal(payload.data.relationships.store.data.id, "store-test");
  assert.equal(payload.data.relationships.variant.data.id, "variant-pro");
  assert.equal(payload.data.attributes.checkout_options.skip_trial, true);
  assert.equal(payload.data.attributes.checkout_data.custom.owner_id, "clerk|user_1");
});

test("keeps active subscribers on the customer portal", async () => {
  configure();
  globalThis.fetch = async () => assert.fail("An active subscriber must not create another checkout");
  const billing = async (_path, body) => body.kind === "identity" ? { ownerId: "clerk|user_1" } : { subscriptionId: "sub_1", status: "active" };
  const response = await POST(request(), {}, session, billing);
  assert.equal(response.status, 409);
});

test("rejects invalid checkout tiers before contacting providers", async () => {
  configure();
  globalThis.fetch = async () => assert.fail("Invalid tier must not contact Lemon Squeezy");
  const response = await POST(request("enterprise"), {}, session, async () => assert.fail("Invalid tier must not contact Convex"));
  assert.equal(response.status, 400);
});
