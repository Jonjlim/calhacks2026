/**
 * HTTP routes. Convex Auth needs its JWT/JWKS endpoints here.
 * P1-B Stripe webhooks (Dev 4) would also register on this router.
 * AI Council routes are documented in CONTRACTS.md § "AI Council".
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { eventsHttp, researchHttp, runsHttp } from "./council";

import { resultsHttp, researchHttp as roomResearchHttp } from "./councilRoom";

const http = httpRouter();

auth.addHttpRoutes(http);

// AI Council: trusted server-to-server ingest for the Fetch.ai coordinator (Bearer COUNCIL_INGEST_SECRET).
http.route({ path: "/council/runs", method: "POST", handler: runsHttp });
http.route({ path: "/council/events", method: "POST", handler: eventsHttp });
http.route({ path: "/council/research", method: "POST", handler: researchHttp });

http.route({ path: "/council/results", method: "POST", handler: resultsHttp });
http.route({ path: "/council/room-research", method: "POST", handler: roomResearchHttp });

export default http;
