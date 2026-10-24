import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityNotifications } from "./activity-notifications";

const identity = vi.hoisted(() => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => identity,
}));

class FakeEventSource {
  static current?: FakeEventSource;
  listeners = new Map<string, () => void>();
  constructor(public url: string) {
    FakeEventSource.current = this;
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  close() {}
  emit(name: string) {
    this.listeners.get(name)?.();
  }
}

const actor = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  username: "friend",
  displayName: "Friend",
  avatarUrl: null,
  isPrivate: false,
};
const event = (kind: string, n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  kind,
  actor,
  postId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  commentId:
    kind === "POST_LIKE" ? null : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  createdAt: "2026-10-24T10:00:00.000Z",
});

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.current = undefined;
});

describe("activity notifications", () => {
  it("shows all four interactions and reloads after a notice", async () => {
    let items = [event("POST_LIKE", 1), event("COMMENT", 2)];
    const fetch = vi.fn(async () => Response.json({ items, nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    render(<ActivityNotifications />);
    expect(await screen.findByText("оценил(а) вашу публикацию")).toBeTruthy();
    expect(
      screen.getByText("оставил(а) комментарий к вашей публикации"),
    ).toBeTruthy();
    expect(FakeEventSource.current?.url).toBe("/api/v1/direct/events");
    items = [event("REPLY", 3), event("COMMENT_LIKE", 4)];
    FakeEventSource.current?.emit("notification");
    await waitFor(() =>
      expect(screen.getByText("ответил(а) на ваш комментарий")).toBeTruthy(),
    );
    expect(screen.getByText("оценил(а) ваш комментарий")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
