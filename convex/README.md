# Convex setup

1. Create a Convex deployment with `npx convex dev` and set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` from its deployment URL.
2. Enable the Convex integration in Clerk. Set `CLERK_JWT_ISSUER_DOMAIN` to the Clerk Frontend API URL and configure the Clerk JWT template/application ID as `convex`.
3. Set `CLERK_JWT_ISSUER_DOMAIN` in Convex environment variables, then redeploy so `auth.config.ts` is applied.

For local development, fill in `.env.local`, run `npx convex dev` in one terminal, and run `npm run dev` in another. Keep local Clerk, Convex, and Lemon Squeezy test credentials separate from production.

## Lemon Squeezy billing

Create monthly Starter ($2.99) and Pro ($9.99) variants with trials disabled. Set `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_STARTER_VARIANT_ID`, `LEMON_SQUEEZY_PRO_VARIANT_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, and a long random `BILLING_SERVER_SECRET` in the Next.js deployment. Set the store ID, both variant IDs, and the same `BILLING_SERVER_SECRET` in Convex. Keep the webhook signing secret only in Next.js.

Configure a Lemon Squeezy webhook pointing to `https://<your-domain>/api/billing/webhook` for subscription lifecycle and subscription payment events. Use the signing secret shown by Lemon Squeezy. For local testing, expose the Next.js server with a secure tunnel and configure that public URL in Lemon Squeezy test mode. Checkout redirects do not update access; deliver a valid webhook to activate or change a subscription.
4. Set Clerk's publishable and secret keys and `TINYFISH_API_KEY` in the app environment. Use the production Clerk instance and production Convex deployment for production.

The app does not read the old `pathpilot:*` browser storage. Existing browser-only workspaces are not imported into a new account.

## Production deploy and operations

1. Create a production Convex deployment and a separate preview/dev deployment. Configure Clerk's Convex JWT issuer on each deployment, then deploy the backend with `npx convex deploy` while targeting the production deployment. Set `CLERK_JWT_ISSUER_DOMAIN`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_STARTER_VARIANT_ID`, `LEMON_SQUEEZY_PRO_VARIANT_ID`, and `BILLING_SERVER_SECRET` in the production Convex deployment through its dashboard or CLI. Deploy Convex before the frontend. Use matching store/variant values for the corresponding app environment.
2. Import this repository into Vercel as a Next.js project. Configure production and preview environment variables separately. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CONVEX_URL` are public; `CLERK_SECRET_KEY`, `TINYFISH_API_KEY`, Lemon Squeezy API/webhook secrets, and `BILLING_SERVER_SECRET` must remain server-side. Use test Clerk/Lemon Squeezy accounts and a preview Convex deployment for preview builds. Never use test provider credentials for production.
3. The job scout declares Node.js runtime and `maxDuration = 360` seconds to cover its sequential provider calls and final usage settlement. Career research handlers declare Node.js runtime and `maxDuration = 300` seconds. Configure Vercel Functions to allow at least 360 seconds (for example, Pro or Enterprise with Fluid Compute); Hobby deployments capped at 300 seconds cannot support the full job scout maximum. See [Vercel's duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).
4. In Lemon Squeezy, configure the test webhook URL on the preview host and a separate live webhook URL on the production host, both at `/api/billing/webhook`. Subscribe to subscription lifecycle and subscription payment events. Confirm the correct signing secret and variant IDs are set in each environment. A successful checkout redirect is not proof of entitlement; verify the matching signed webhook arrives and the account's plan/allowance changes in the app.
5. Before launch, use a Vercel preview paired with preview Convex, Clerk development credentials, and Lemon Squeezy test mode. Sign in, run a complete plan, verify findings persist after reload, complete checkout and confirm webhook-driven Starter/Pro access, then verify deletion is blocked until cancellation and removes the workspace, usage, and Clerk identity. Do not use live purchases for this check.

### Recovery checks

- For missing or timed-out research, inspect Vercel Function logs for `/api/job-scout` or `/api/[workflow]`, confirm `TINYFISH_API_KEY`, and check TinyFish Search, Fetch, and Agent status. Route failures are returned to the learner and logged with the workflow name.
- For missing paid access, check the Vercel `/api/billing/webhook` log, verify the configured webhook URL and signature secret, then check Convex logs and environment variables. Lemon Squeezy retries non-success webhook responses; replay the event after fixing configuration. Never edit an entitlement directly from a checkout URL or redirect.
- For account deletion failures, inspect the account deletion route log and Clerk status. Convex data is removed before the Clerk user; if Clerk deletion fails, the learner can retry while still signed in. Cancel an active subscription through the customer portal first. A hashed deletion marker is retained so a delayed signed webhook cannot recreate billing data.
- Use Vercel Function logs and Convex deployment logs as the initial diagnostics. Do not include API keys, webhook signatures, or full billing payloads in support reports.
