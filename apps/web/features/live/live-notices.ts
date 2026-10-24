"use client";

import { useEffect, useRef } from "react";
import { LiveNoticeSchema } from "@instagram/contracts";

// SSE "live" notices arrive on the tab's one global stream (opened by the
// calls provider; the API allows five streams per user). They carry only a
// stream id and are re-dispatched as a window event for the live UI.
const EVENT = "instagram-live";

export function relayLiveNotice(data: string) {
  try {
    const notice = LiveNoticeSchema.safeParse(JSON.parse(data));
    if (notice.success)
      window.dispatchEvent(new CustomEvent(EVENT, { detail: notice.data.liveId }));
  } catch {
    // A malformed hint is ignored; polling repairs the state.
  }
}

export function useLiveNotices(onNotice: (liveId: string) => void) {
  const handler = useRef(onNotice);
  useEffect(() => {
    handler.current = onNotice;
  });
  useEffect(() => {
    const listener = (event: Event) =>
      handler.current((event as CustomEvent<string>).detail);
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
}
