export function convexSiteUrl(url = process.env.NEXT_PUBLIC_CONVEX_URL) {
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(".convex.cloud", ".convex.site");
  if (parsed.port === "3210") parsed.port = "3211";
  return parsed.origin;
}

export async function billingRequest(path, body, token) {
  const secret = process.env.BILLING_SERVER_SECRET;
  if (!secret) throw new Error("Billing server secret is not configured.");
  const response = await fetch(`${convexSiteUrl()}/waypoint/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-waypoint-server-secret": secret,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Billing service returned ${response.status}.`);
  return response.json();
}
