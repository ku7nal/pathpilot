import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { billingRequest } from "../../../../lib/billing-backend.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing payload", { status: 400 });
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const signature = request.headers.get("x-signature") || "";
  if (!secret || !/^[a-f\d]{64}$/i.test(signature)) return new Response("Invalid signature", { status: 401 });
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return new Response("Invalid signature", { status: 401 });
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const eventName = request.headers.get("x-event-name");
  if (!eventName || payload?.meta?.event_name !== eventName || !payload?.data) return new Response("Invalid event", { status: 400 });
  try {
    await billingRequest("webhook", { eventKey: createHash("sha256").update(raw).digest("hex"), eventName, payload });
    return new Response("OK");
  } catch {
    return new Response("Webhook processing failed", { status: 503 });
  }
}
