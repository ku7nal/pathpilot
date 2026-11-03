/* eslint-disable */
import { anyApi } from "convex/server";
import type * as billing from "../billing";
import type * as accounts from "../accounts";
import type * as workspaces from "../workspaces";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{ accounts: typeof accounts; billing: typeof billing; workspaces: typeof workspaces }>;
export const api = anyApi as unknown as FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export const internal = anyApi as unknown as FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
