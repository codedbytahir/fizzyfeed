import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "./api";
import type { MeResponse } from "@shared/types";

/**
 * Session state for the shell + routes. /api/auth/me 401s ONLY for visitors
 * with no valid browser session (spec 02 §5) — that is a normal state here,
 * not an error. A valid session whose Buffer token died still returns 200
 * with needsReconnect: true, so the app stays open and shows a reconnect
 * flow instead of logging the user out (the 30-day session cookie and the
 * 1-hour Buffer access token are different lifetimes).
 */
export type MeState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "ready"; me: MeResponse };

interface MeContextValue {
  state: MeState;
  refresh: () => void;
}

const MeContext = createContext<MeContextValue | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    apiFetch<MeResponse>("/api/auth/me")
      .then((me) => {
        if (!alive) return;
        setState({ status: "ready", me });
      })
      .catch(() => {
        if (alive) setState({ status: "anon" });
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  return <MeContext.Provider value={{ state, refresh }}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used inside MeProvider");
  return ctx;
}
