"use client";

import { useEffect, useReducer, useRef } from "react";
import type { DirectMessage } from "@instagram/contracts";

import type { ApiFailure } from "@/lib/api/client";
import { createDirectClient } from "@/lib/api/direct";
import { describeFailure } from "@/lib/api/messages";

// A message the user wrote that the server has not confirmed yet. Its
// clientMessageId is fixed at creation and reused by every retry.
export type Outgoing = {
  clientMessageId: string;
  text: string;
  status: "sending" | "failed";
  error?: string;
};

type State = {
  byId: Record<string, DirectMessage>;
  // Cursor for older history; null once the oldest page is loaded.
  older: string | null;
  loaded: boolean;
  loading: boolean;
  failure?: ApiFailure;
  outbox: Outgoing[];
};
type Action =
  | { type: "start" }
  | { type: "page"; items: DirectMessage[]; older?: string | null }
  | { type: "fail"; failure: ApiFailure }
  | { type: "queue"; message: Outgoing }
  | { type: "sent"; message: DirectMessage }
  | { type: "unsent"; clientMessageId: string; error: string }
  | { type: "drop"; clientMessageId: string };

function merge(byId: State["byId"], items: DirectMessage[]) {
  const next = { ...byId };
  for (const item of items) next[item.id] = item;
  return next;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "start":
      return { ...state, loading: true, failure: undefined };
    case "page":
      return {
        ...state,
        byId: merge(state.byId, action.items),
        // A refresh of the newest page keeps the existing older cursor.
        older: action.older === undefined ? state.older : action.older,
        loaded: true,
        loading: false,
      };
    case "fail":
      return { ...state, loading: false, failure: action.failure };
    case "queue":
      return { ...state, outbox: [...state.outbox, action.message] };
    case "sent":
      return {
        ...state,
        byId: merge(state.byId, [action.message]),
        outbox: state.outbox.filter(
          (item) => item.clientMessageId !== action.message.clientMessageId,
        ),
      };
    case "unsent":
      return {
        ...state,
        outbox: state.outbox.map((item) =>
          item.clientMessageId === action.clientMessageId
            ? { ...item, status: "failed", error: action.error }
            : item,
        ),
      };
    case "drop":
      return {
        ...state,
        outbox: state.outbox.filter(
          (item) => item.clientMessageId !== action.clientMessageId,
        ),
      };
  }
}

const byTime = (a: DirectMessage, b: DirectMessage) =>
  a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);

async function fetchPage(
  conversationId: string,
  cursor: string | undefined,
  signal: AbortSignal,
  refresh: boolean,
  dispatch: (action: Action) => void,
) {
  const result = await createDirectClient().messages(conversationId, cursor, signal);
  if (signal.aborted) return;
  if (!result.ok) {
    dispatch({ type: "fail", failure: result.failure });
    return;
  }
  dispatch({
    type: "page",
    items: result.data.items,
    // A refresh of the newest page keeps the cursor for older history.
    older: refresh ? undefined : result.data.nextCursor,
  });
}

// History of one conversation, oldest at the top. Pages from the server and
// confirmed sends are merged by id, so a refresh or a retried send never
// shows a message twice. Until realtime (stage 7) refresh() re-reads the
// newest page.
export function useThread(conversationId: string, onSent?: () => void) {
  const [state, dispatch] = useReducer(reduce, {
    byId: {},
    older: null,
    loaded: false,
    loading: true,
    outbox: [],
  });
  const request = useRef<AbortController | undefined>(undefined);

  function load(cursor?: string, refresh = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void fetchPage(conversationId, cursor, controller.signal, refresh, dispatch);
  }

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void fetchPage(conversationId, undefined, controller.signal, false, dispatch);
    return () => request.current?.abort();
  }, [conversationId]);

  async function deliver(message: Outgoing) {
    const result = await createDirectClient().send(conversationId, {
      clientMessageId: message.clientMessageId,
      text: message.text,
    });
    if (result.ok) {
      dispatch({ type: "sent", message: result.data.message });
      onSent?.();
    } else
      dispatch({
        type: "unsent",
        clientMessageId: message.clientMessageId,
        error: describeFailure(result.failure),
      });
  }

  return {
    messages: Object.values(state.byId).sort(byTime),
    outbox: state.outbox,
    loaded: state.loaded,
    loading: state.loading,
    failure: state.failure,
    hasOlder: state.older !== null,
    loadOlder() {
      if (!state.older) return;
      dispatch({ type: "start" });
      load(state.older);
    },
    refresh() {
      dispatch({ type: "start" });
      load(undefined, state.loaded);
    },
    send(text: string) {
      const message: Outgoing = {
        clientMessageId: crypto.randomUUID(),
        text,
        status: "sending",
      };
      dispatch({ type: "queue", message });
      void deliver(message);
    },
    // Same clientMessageId: if the first attempt was stored after all, the
    // server returns that message instead of a duplicate.
    retry(clientMessageId: string) {
      const message = state.outbox.find(
        (item) => item.clientMessageId === clientMessageId,
      );
      if (!message || message.status === "sending") return;
      const again = { ...message, status: "sending" as const, error: undefined };
      dispatch({ type: "drop", clientMessageId });
      dispatch({ type: "queue", message: again });
      void deliver(again);
    },
    discard(clientMessageId: string) {
      dispatch({ type: "drop", clientMessageId });
    },
  };
}
