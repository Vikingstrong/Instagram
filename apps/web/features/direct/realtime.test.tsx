import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Thread } from "./thread";
import { useDirectEvents, type DirectNotice } from "./use-direct-events";

const me = "4f70d2ab-d6d6-4243-b0d3-f7b767434789";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversationId = uuid(1);
const peer = { id: uuid(2), username: "friend", displayName: "", avatarUrl: null, isPrivate: false };
const message = (n: number) => ({
  id: uuid(100 + n),
  conversationId,
  senderId: peer.id,
  clientMessageId: uuid(300 + n),
  text: `m${n}`,
  createdAt: new Date(Date.UTC(2026, 9, 23, 10, 0, n)).toISOString(),
});
const newestFirst = (from: number, to: number) => {
  const items = [];
  for (let n = from; n >= to; n--) items.push(message(n));
  return items;
};

// Controllable EventSource: tests fire server events by hand.
class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data = "{}") {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
  fail(closed: boolean) {
    if (closed) this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Probe(props: { onNotice: (notice: DirectNotice) => void; onSync: () => void }) {
  const state = useDirectEvents({ enabled: true, ...props });
  return <p>{state}</p>;
}

describe("event stream", () => {
  it("syncs only after ready, forwards notices and resyncs on return to the tab", () => {
    const onSync = vi.fn();
    const onNotice = vi.fn();
    const { unmount } = render(<Probe onSync={onSync} onNotice={onNotice} />);
    const [source] = FakeEventSource.instances;
    expect(source!.url).toBe("/api/v1/direct/events");
    expect(screen.getByText("connecting")).toBeTruthy();
    expect(onSync).not.toHaveBeenCalled();

    act(() => source!.emit("ready"));
    expect(screen.getByText("live")).toBeTruthy();
    expect(onSync).toHaveBeenCalledTimes(1);
    act(() => source!.emit("message", JSON.stringify({ conversationId, messageId: uuid(9) })));
    expect(onNotice).toHaveBeenCalledWith({ conversationId, messageId: uuid(9) });
    act(() => source!.emit("message", "not json"));
    expect(onNotice).toHaveBeenCalledTimes(1);

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(onSync).toHaveBeenCalledTimes(2);
    unmount();
    expect(source!.closed).toBe(true);
  });

  it("shows the outage and reopens a refused stream with backoff, then syncs again", () => {
    vi.useFakeTimers();
    const onSync = vi.fn();
    render(<Probe onSync={onSync} onNotice={() => {}} />);
    const [first] = FakeEventSource.instances;
    act(() => first!.emit("ready"));
    // A transient error: the browser itself reconnects the same source.
    act(() => first!.fail(false));
    expect(screen.getByText("offline")).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(1);
    // Closed for good (e.g. API restart): a new stream after the backoff.
    act(() => first!.fail(true));
    act(() => vi.advanceTimersByTime(2_000));
    const second = FakeEventSource.instances[1];
    expect(second).toBeTruthy();
    act(() => second!.emit("ready"));
    expect(screen.getByText("live")).toBeTruthy();
    expect(onSync).toHaveBeenCalledTimes(2);
  });
});

describe("conversation sync", () => {
  it("fills a gap after a long disconnection without duplicates", async () => {
    let phase: "start" | "later" = "start";
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://localhost");
        if (url.pathname === `/api/v1/direct/conversations/${conversationId}`)
          return Response.json({
            conversation: { id: conversationId, peer, lastMessage: null, lastActivityAt: message(1).createdAt },
          });
        const cursor = url.searchParams.get("cursor");
        requests.push(cursor ?? "newest");
        if (phase === "start") return Response.json({ items: newestFirst(2, 1), nextCursor: null });
        // 45 messages arrived while offline: three pages back to a known one.
        if (!cursor) return Response.json({ items: newestFirst(47, 28), nextCursor: "cGFnZTI" });
        if (cursor === "cGFnZTI") return Response.json({ items: newestFirst(27, 8), nextCursor: "cGFnZTM" });
        return Response.json({ items: newestFirst(7, 1), nextCursor: null });
      }),
    );
    const props = { conversationId, viewerId: me, connection: "live" as const, onActivity: () => {} };
    const view = render(<Thread {...props} syncKey={0} />);
    await screen.findByText("m2");
    phase = "later";
    requests.length = 0;
    view.rerender(<Thread {...props} syncKey={1} />);
    await screen.findByText("m47");
    await waitFor(() => expect(screen.getByText("m8")).toBeTruthy());
    const items = within(screen.getByRole("list", { name: "Сообщения" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(
      Array.from({ length: 47 }, (_, index) => `m${index + 1}`),
    );
    expect(requests).toEqual(["newest", "cGFnZTI", "cGFnZTM"]);
  });

  it("tells the user when messages may be late", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        new URL(input, "http://localhost").pathname.endsWith("/messages")
          ? Response.json({ items: [], nextCursor: null })
          : Response.json({
              conversation: { id: conversationId, peer, lastMessage: null, lastActivityAt: message(1).createdAt },
            }),
      ),
    );
    render(
      <Thread conversationId={conversationId} viewerId={me} syncKey={0} connection="offline" onActivity={() => {}} />,
    );
    expect((await screen.findByText(/Нет соединения/)).textContent).toBe("Нет соединения. Переподключаемся…");
  });
});
