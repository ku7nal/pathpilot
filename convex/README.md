# Convex setup

1. Create a Convex deployment with `npx convex dev` and set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` from its deployment URL.
2. Enable the Convex integration in Clerk. Set `CLERK_JWT_ISSUER_DOMAIN` to the Clerk Frontend API URL and configure the Clerk JWT template/application ID as `convex`.
3. Set `CLERK_JWT_ISSUER_DOMAIN` in Convex environment variables, then redeploy so `auth.config.ts` is applied.

## Lemon Squeezy billing

Create monthly Starter ($2.99) and Pro ($9.99) variants with trials disabled. Set `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_STARTER_VARIANT_ID`, `LEMON_SQUEEZY_PRO_VARIANT_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, and a long random `BILLING_SERVER_SECRET` in the Next.js deployment. Set the store ID, both variant IDs, and the same `BILLING_SERVER_SECRET` in Convex. Keep the webhook signing secret only in Next.js.

Configure a Lemon Squeezy webhook pointing to `https://<your-domain>/api/billing/webhook` for subscription lifecycle and subscription payment events. Use the signing secret shown by Lemon Squeezy. For local testing, expose the Next.js server with a secure tunnel and configure that public URL in Lemon Squeezy test mode. Checkout redirects do not update access; deliver a valid webhook to activate or change a subscription.
4. Set Clerk's publishable and secret keys and `TINYFISH_API_KEY` in the app environment. Use the production Clerk instance and production Convex deployment for production.

The app does not read the old `pathpilot:*` browser storage. Existing browser-only workspaces are not imported into a new account.
