/**
 * Convex Auth with anonymous sign-in. Owner: Dev 2 (BE-002).
 * Client: wrap the app in ConvexAuthProvider and call signIn("anonymous").
 * Deployment env: JWT_PRIVATE_KEY, JWKS, SITE_URL (set via `npx @convex-dev/auth`).
 */
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Anonymous],
});
