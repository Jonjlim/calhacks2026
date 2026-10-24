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
import type * as agents_engine from "../agents/engine.js";
import type * as agents_extract from "../agents/extract.js";
import type * as agents_ideas from "../agents/ideas.js";
import type * as agents_mediaRuntime from "../agents/mediaRuntime.js";
import type * as agents_model from "../agents/model.js";
import type * as agents_photo from "../agents/photo.js";
import type * as agents_policy from "../agents/policy.js";
import type * as agents_presentation from "../agents/presentation.js";
import type * as agents_recipient from "../agents/recipient.js";
import type * as agents_recipientPolicy from "../agents/recipientPolicy.js";
import type * as agents_runtime from "../agents/runtime.js";
import type * as agents_screenshot from "../agents/screenshot.js";
import type * as agents_smoke from "../agents/smoke.js";
import type * as agents_stats from "../agents/stats.js";
import type * as agents_verify from "../agents/verify.js";
import type * as allocations from "../allocations.js";
import type * as auth from "../auth.js";
import type * as cleanup from "../cleanup.js";
import type * as clues from "../clues.js";
import type * as council from "../council.js";
import type * as councilRoom from "../councilRoom.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_input from "../lib/input.js";
import type * as lib_knowledge from "../lib/knowledge.js";
import type * as lib_proposalEngine from "../lib/proposalEngine.js";
import type * as lib_result from "../lib/result.js";
import type * as lib_views from "../lib/views.js";
import type * as map from "../map.js";
import type * as media from "../media.js";
import type * as messages from "../messages.js";
import type * as payments_checkout from "../payments/checkout.js";
import type * as payments_read from "../payments/read.js";
import type * as payments_reconcile from "../payments/reconcile.js";
import type * as payments_stripe from "../payments/stripe.js";
import type * as payments_webhook from "../payments/webhook.js";
import type * as payments_state from "../payments/state.js";
import type * as payments_stateMachine from "../payments/stateMachine.js";
import type * as payments_sync from "../payments/sync.js";
import type * as proposals from "../proposals.js";
import type * as research_brief from "../research/brief.js";
import type * as research_catalog from "../research/catalog.js";
import type * as research_catalogEvidence from "../research/catalogEvidence.js";
import type * as research_fashion from "../research/fashion.js";
import type * as research_fashionPolicy from "../research/fashionPolicy.js";
import type * as research_fashionProvider from "../research/fashionProvider.js";
import type * as research_fashionSchema from "../research/fashionSchema.js";
import type * as research_fixtures_maya from "../research/fixtures/maya.js";
import type * as research_normalize from "../research/normalize.js";
import type * as research_provider from "../research/provider.js";
import type * as research_research from "../research/research.js";
import type * as research_score from "../research/score.js";
import type * as research_text from "../research/text.js";
import type * as rooms from "../rooms.js";
import type * as validators from "../validators.js";
import type * as votes from "../votes.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/buyer": typeof agents_buyer;
  "agents/engine": typeof agents_engine;
  "agents/extract": typeof agents_extract;
  "agents/ideas": typeof agents_ideas;
  "agents/mediaRuntime": typeof agents_mediaRuntime;
  "agents/model": typeof agents_model;
  "agents/photo": typeof agents_photo;
  "agents/policy": typeof agents_policy;
  "agents/presentation": typeof agents_presentation;
  "agents/recipient": typeof agents_recipient;
  "agents/recipientPolicy": typeof agents_recipientPolicy;
  "agents/runtime": typeof agents_runtime;
  "agents/screenshot": typeof agents_screenshot;
  "agents/smoke": typeof agents_smoke;
  "agents/stats": typeof agents_stats;
  "agents/verify": typeof agents_verify;
  allocations: typeof allocations;
  auth: typeof auth;
  cleanup: typeof cleanup;
  clues: typeof clues;
  council: typeof council;
  councilRoom: typeof councilRoom;
  crons: typeof crons;
  demo: typeof demo;
  http: typeof http;
  jobs: typeof jobs;
  "lib/auth": typeof lib_auth;
  "lib/input": typeof lib_input;
  "lib/knowledge": typeof lib_knowledge;
  "lib/proposalEngine": typeof lib_proposalEngine;
  "lib/result": typeof lib_result;
  "lib/views": typeof lib_views;
  map: typeof map;
  media: typeof media;
  messages: typeof messages;
  "payments/checkout": typeof payments_checkout;
  "payments/read": typeof payments_read;
  "payments/reconcile": typeof payments_reconcile;
  "payments/stripe": typeof payments_stripe;
  "payments/webhook": typeof payments_webhook;
  "payments/state": typeof payments_state;
  "payments/stateMachine": typeof payments_stateMachine;
  "payments/sync": typeof payments_sync;
  proposals: typeof proposals;
  "research/brief": typeof research_brief;
  "research/catalog": typeof research_catalog;
  "research/catalogEvidence": typeof research_catalogEvidence;
  "research/fashion": typeof research_fashion;
  "research/fashionPolicy": typeof research_fashionPolicy;
  "research/fashionProvider": typeof research_fashionProvider;
  "research/fashionSchema": typeof research_fashionSchema;
  "research/fixtures/maya": typeof research_fixtures_maya;
  "research/normalize": typeof research_normalize;
  "research/provider": typeof research_provider;
  "research/research": typeof research_research;
  "research/score": typeof research_score;
  "research/text": typeof research_text;
  rooms: typeof rooms;
  validators: typeof validators;
  votes: typeof votes;
  worlds: typeof worlds;
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
