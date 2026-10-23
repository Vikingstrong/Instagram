"use client";

import { useEffect, useRef, useState } from "react";

export type DirectNotice = { conversationId: string; messageId: string };
export type ConnectionState = "connecting" | "live" | "offline";

const EVENTS_PATH = "/api/v1/direct/events";
const RESYNC_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

// One SSE stream per tab (stage 7). Order matters: the stream subscribes
// first and the server says "ready"; only then does onSync() read history
// over REST, so nothing sent in between is missed. Notices carry ids only.
// Reconnects, a return to the tab and a periodic timer sync again, because
// a lost notice must never mean a lost message.
export function useDirectEvents({
  enabled,
  onNotice,
  onSync,
}: {
  // False without a signed-in user: the stream would only be refused.
  enabled: boolean;
  onNotice: (notice: DirectNotice) => void;
  onSync: () => void;
}): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const handlers = useRef({ onNotice, onSync });
  useEffect(() => {
    handlers.current = { onNotice, onSync };
  });

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    function connect() {
      source = new EventSource(EVENTS_PATH);
      source.addEventListener("ready", () => {
        failures = 0;
        setState("live");
        handlers.current.onSync();
      });
      source.addEventListener("message", (event) => {
        try {
          handlers.current.onNotice(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          // A malformed notice is ignored; the next sync repairs state.
        }
      });
      source.onerror = () => {
        setState("offline");
        // The browser retries by itself unless the stream was refused or
        // ended for good (e.g. 401 after logout); then back off and reopen.
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          source.close();
          failures += 1;
          retry = setTimeout(connect, Math.min(1000 * 2 ** failures, MAX_BACKOFF_MS));
        }
      };
    }

    const resync = () => {
      if (document.visibilityState === "visible") handlers.current.onSync();
    };
    connect();
    const timer = setInterval(resync, RESYNC_MS);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
    };
  }, [enabled]);

  return state;
}
