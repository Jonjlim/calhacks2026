/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_buyer from "../agents/buyer.js";
import type * as agents_extract from "../agents/extract.js";
import type * as agents_policy from "../agents/policy.js";
import type * as allocations from "../allocations.js";
import type * as auth from "../auth.js";
import type * as clues from "../clues.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_knowledge from "../lib/knowledge.js";
import type * as lib_proposalEngine from "../lib/proposalEngine.js";
import type * as lib_result from "../lib/result.js";
import type * as lib_views from "../lib/views.js";
import type * as messages from "../messages.js";
import type * as proposals from "../proposals.js";
import type * as research_normalize from "../research/normalize.js";
import type * as research_research from "../research/research.js";
import type * as research_score from "../research/score.js";
import type * as rooms from "../rooms.js";
import type * as validators from "../validators.js";
import type * as votes from "../votes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/buyer": typeof agents_buyer;
  "agents/extract": typeof agents_extract;
  "agents/policy": typeof agents_policy;
  allocations: typeof allocations;
  auth: typeof auth;
  clues: typeof clues;
  http: typeof http;
  jobs: typeof jobs;
  "lib/auth": typeof lib_auth;
  "lib/input": typeof lib_input;
  "lib/knowledge": typeof lib_knowledge;
  "lib/proposalEngine": typeof lib_proposalEngine;
  "lib/result": typeof lib_result;
  "lib/views": typeof lib_views;
  messages: typeof messages;
  proposals: typeof proposals;
  "research/normalize": typeof research_normalize;
  "research/research": typeof research_research;
  "research/score": typeof research_score;
  rooms: typeof rooms;
  validators: typeof validators;
  votes: typeof votes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
