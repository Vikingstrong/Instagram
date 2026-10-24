"use client";

import { useEffect, useReducer, useRef } from "react";
import type { DirectMessage } from "@instagram/contracts";

import type { ApiFailure } from "@/lib/api/client";
import { createDirectClient } from "@/lib/api/direct";
import { describeFailure } from "@/lib/api/messages";

// A message the user wrote that the server has not confirmed yet. Its
// clientMessageId is fixed at creation and reused by every retry.
export type OutgoingAttachment = { file: File; type: "image" | "voice" };
export type Outgoing = {
  attachment?: OutgoingAttachment;
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
        // A sync of the newest pages keeps the existing older cursor.
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
  dispatch: (action: Action) => void,
) {
  const result = await createDirectClient().messages(
    conversationId,
    cursor,
    signal,
  );
  if (signal.aborted) return;
  if (!result.ok) {
    dispatch({ type: "fail", failure: result.failure });
    return;
  }
  dispatch({
    type: "page",
    items: result.data.items,
    older: result.data.nextCursor,
  });
}

// Most pages a sync reads back while looking for a message it already has.
const MAX_SYNC_PAGES = 10;

// History of one conversation, oldest at the top. Pages from the server and
// confirmed sends are merged by id, so a sync, a notice or a retried send
// never shows a message twice. sync() reads newest pages until it reaches a
// known message, which also closes a gap left by a long disconnection.
export function useThread(conversationId: string, onSent?: () => void) {
  const [state, dispatch] = useReducer(reduce, {
    byId: {},
    older: null,
    loaded: false,
    loading: true,
    outbox: [],
  });
  const request = useRef<AbortController | undefined>(undefined);
  const deliveries = useRef(new Set<AbortController>());
  const known = useRef(new Set<string>());
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  useEffect(() => {
    known.current = new Set(Object.keys(state.byId));
  });

  function load(cursor?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void fetchPage(conversationId, cursor, controller.signal, dispatch);
  }

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void fetchPage(conversationId, undefined, controller.signal, dispatch);
    const active = deliveries.current;
    return () => {
      request.current?.abort();
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, [conversationId]);

  async function sync(): Promise<void> {
    // One sync at a time; a request made meanwhile runs once afterwards.
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      const client = createDirectClient();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        const result = await client.messages(conversationId, cursor);
        // A failed sync stays silent; the next notice or timer repeats it.
        if (!result.ok) return;
        const { items, nextCursor } = result.data;
        const reached =
          known.current.size === 0 ||
          items.some((item) => known.current.has(item.id));
        dispatch({ type: "page", items, older: undefined });
        if (reached || !nextCursor) return;
        cursor = nextCursor;
      }
    } finally {
      syncing.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }

  async function deliver(message: Outgoing) {
    const controller = new AbortController();
    deliveries.current.add(controller);
    const client = createDirectClient();
    const body = {
      clientMessageId: message.clientMessageId,
      text: message.text,
    };
    const result = message.attachment
      ? await client.sendMedia(
          conversationId,
          body,
          message.attachment.file,
          message.attachment.type,
          controller.signal,
        )
      : await client.send(conversationId, body, controller.signal);
    deliveries.current.delete(controller);
    if (controller.signal.aborted) return;
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
    sync() {
      void sync();
    },
    // Repeats the failed history read: the first page or the older one.
    reload() {
      dispatch({ type: "start" });
      load(state.loaded ? (state.older ?? undefined) : undefined);
    },
    send(text: string, attachment?: OutgoingAttachment) {
      const message: Outgoing = {
        clientMessageId: crypto.randomUUID(),
        text,
        attachment,
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
      const again = {
        ...message,
        status: "sending" as const,
        error: undefined,
      };
      dispatch({ type: "drop", clientMessageId });
      dispatch({ type: "queue", message: again });
      void deliver(again);
    },
    discard(clientMessageId: string) {
      dispatch({ type: "drop", clientMessageId });
    },
  };
}
