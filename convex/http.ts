/**
 * HTTP routes. Convex Auth needs its JWT/JWKS endpoints here.
 * P1-B Stripe webhooks (Dev 4) would also register on this router.
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
