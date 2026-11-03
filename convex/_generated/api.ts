/* eslint-disable */
import { anyApi } from "convex/server";
import type * as workspaces from "../workspaces";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{ workspaces: typeof workspaces }>;
export const api = anyApi as unknown as FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export const internal = anyApi as unknown as FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
