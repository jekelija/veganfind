"use client";

/**
 * CONTRACT STUB — implemented by the auth/API workstream.
 * The map UI may import this hook; keep the signature stable.
 */

import { useEffect, useState } from "react";
import type { MeResponse } from "@/lib/types";

export interface UseUserResult {
  user: MeResponse["user"];
  authConfigured: boolean;
  loading: boolean;
  refresh: () => void;
}

export function useUser(): UseUserResult {
  const [state, setState] = useState<Omit<UseUserResult, "refresh">>({
    user: null,
    authConfigured: false,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => r.json())
      .then((me: MeResponse) => {
        if (!cancelled)
          setState({
            user: me.user,
            authConfigured: me.authConfigured,
            loading: false,
          });
      })
      .catch(() => {
        if (!cancelled)
          setState({ user: null, authConfigured: false, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...state, refresh: () => setNonce((n) => n + 1) };
}
