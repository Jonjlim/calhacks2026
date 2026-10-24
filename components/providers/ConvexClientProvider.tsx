"use client";

import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

const SIGN_IN_TIMEOUT_MS = 15_000;

export type SessionStatus = "offline" | "connecting" | "ready" | "error";

export interface Session {
  /** `offline` means no Convex deployment is configured (mock-only UI). */
  status: SessionStatus;
  /** Resolves true once the anonymous session is authenticated. */
  ensureReady(): Promise<boolean>;
  retry(): void;
}

const offlineSession: Session = { status: "offline", ensureReady: async () => false, retry: () => {} };
const SessionContext = createContext<Session>(offlineSession);

export function useSession(): Session {
  return useContext(SessionContext);
}

/** Renders without Convex when NEXT_PUBLIC_CONVEX_URL is unset so mock-only UI work still runs. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthProvider client={client}>
      <AnonymousSession>{children}</AnonymousSession>
    </ConvexAuthProvider>
  );
}

/** Every visitor gets an anonymous Convex Auth identity; room access is still enforced server-side. */
function AnonymousSession({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [failed, setFailed] = useState(false);
  const signingIn = useRef(false);
  const authenticated = useRef(isAuthenticated);
  const waiters = useRef<Array<(ready: boolean) => void>>([]);

  const settle = useCallback((ready: boolean) => {
    for (const resolve of waiters.current.splice(0)) resolve(ready);
  }, []);

  const attempt = useCallback(() => {
    if (signingIn.current) return;
    signingIn.current = true;
    setFailed(false);
    signIn("anonymous")
      .catch(() => {
        setFailed(true);
        settle(false);
      })
      .finally(() => {
        signingIn.current = false;
      });
  }, [signIn, settle]);

  useEffect(() => {
    authenticated.current = isAuthenticated;
    if (isAuthenticated) settle(true);
    else if (!isLoading) attempt();
  }, [isLoading, isAuthenticated, attempt, settle]);

  const ensureReady = useCallback(() => {
    if (authenticated.current) return Promise.resolve(true);
    attempt();
    return new Promise<boolean>((resolve) => {
      waiters.current.push(resolve);
      setTimeout(() => resolve(authenticated.current), SIGN_IN_TIMEOUT_MS);
    });
  }, [attempt]);

  const status: SessionStatus = isAuthenticated ? "ready" : failed ? "error" : "connecting";
  const value = useMemo<Session>(() => ({ status, ensureReady, retry: attempt }), [status, ensureReady, attempt]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
