# Waypoint workspace acceptance

Run `npm test` for automated Convex persistence, progress, unauthenticated-access, and cross-account checks. Then run these UI checks in a configured Clerk and Convex development deployment.

1. Open Waypoint signed out. Confirm sign-in and create-account actions appear and job research does not run.
2. Create an account, confirm the account button appears, scout a goal, and run career-plan research.
3. Save a learning resource and complete a project milestone. Reload and confirm the findings, source links, saved resource, and milestone state remain.
4. Sign out and create a second account. Confirm its workspace list is empty; the first account's browser-local cache is never imported.
5. Sign back into the first account and confirm its workspace can be reopened with the same progress.
6. Call either research endpoint without a Clerk session and confirm it returns 401. Attempt to read or update another account's workspace ID through Convex and confirm the operation fails.
