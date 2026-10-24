"use client";

import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, ConvexReactClient } from "convex/react";
import { useEffect, type ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

/** Every browser gets an anonymous identity; membership is the Participant row, not the account. */
function AnonymousSignIn({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void signIn("anonymous");
  }, [isLoading, isAuthenticated, signIn]);
  return <>{children}</>;
}

/** Renders without Convex when NEXT_PUBLIC_CONVEX_URL is unset so mock-only UI work still runs. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthProvider client={client}>
      <AnonymousSignIn>{children}</AnonymousSignIn>
    </ConvexAuthProvider>
  );
}
