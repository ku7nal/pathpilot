# Convex setup

1. Create a Convex deployment with `npx convex dev` and set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` from its deployment URL.
2. Enable the Convex integration in Clerk. Set `CLERK_JWT_ISSUER_DOMAIN` to the Clerk Frontend API URL and configure the Clerk JWT template/application ID as `convex`.
3. Set `CLERK_JWT_ISSUER_DOMAIN` in Convex environment variables, then redeploy so `auth.config.ts` is applied.
4. Set Clerk's publishable and secret keys and `TINYFISH_API_KEY` in the app environment. Use the production Clerk instance and production Convex deployment for production.

The app does not read the old `pathpilot:*` browser storage. Existing browser-only workspaces are not imported into a new account.
