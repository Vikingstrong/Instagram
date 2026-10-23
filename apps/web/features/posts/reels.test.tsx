import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Reels } from "./reels";

const viewer = {
  id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789",
  email: "person@example.test",
  username: "person",
  emailVerified: true,
};
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => viewer,
  useHomeChecking: () => false,
}));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reel = (n: number) => ({
  id: uuid(n),
  author: {
    id: uuid(500 + n),
    username: `maker_${n}`,
    displayName: "",
    avatarUrl: null,
    isPrivate: false,
  },
  caption: `Ролик ${n}`,
  type: "video",
  image: {
    url: `/api/v1/media/${uuid(100 + n)}/full`,
    thumbnailUrl: `/api/v1/media/${uuid(100 + n)}/thumb`,
    width: 608,
    height: 1080,
  },
  video: { url: `/api/v1/media/${uuid(100 + n)}/video`, durationMs: 5000 },
  status: "ready",
  createdAt: "2026-10-24T10:00:00.000Z",
  likeCount: 2,
  commentCount: 1,
  liked: false,
});

// Test double: lets a test say which reel is on screen.
class FakeObserver {
  static all: FakeObserver[] = [];
  target?: Element;
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  disconnect() {}
  show(visible: boolean) {
    this.callback(
      [{ isIntersecting: visible, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
const observerOf = (caption: string) =>
  FakeObserver.all.find((item) => item.target?.getAttribute("aria-label") === caption)!;

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  play = vi.fn(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event("pause"));
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: play, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { value: pause, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

function api(pages: Record<string, { items: unknown[]; nextCursor: string | null }>) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/v1/auth/csrf") return Response.json({ csrfToken });
    if (init.method === "PUT" && url.pathname === `/api/v1/posts/${uuid(1)}/like`)
      return Response.json({ liked: true, likeCount: 3 });
    if (url.pathname === "/api/v1/reels")
      return Response.json(pages[url.searchParams.get("cursor") ?? "first"]);
    throw new Error(`Unexpected ${init.method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Reels", () => {
  it("plays only the reel on screen, muted until sound is turned on", async () => {
    api({ first: { items: [reel(1), reel(2)], nextCursor: null } });
    render(<Reels />);
    const first = (await screen.findByLabelText("Ролик 1")) as HTMLVideoElement;
    const second = screen.getByLabelText("Ролик 2") as HTMLVideoElement;
    expect(first.getAttribute("src")).toBe(`/api/v1/media/${uuid(101)}/video`);
    expect(first.muted).toBe(true);
    expect(first.hasAttribute("loop")).toBe(true);
    await waitFor(() => expect(observerOf("Ролик 2")).toBeDefined());

    // The video DOM can appear before its passive effect attaches the observer.
    // Await that observable readiness instead of relying on scheduler speed.
    await waitFor(() => expect(observerOf("Ролик 1")).toBeDefined());
    act(() => observerOf("Ролик 1").show(true));
    expect(play.mock.contexts).toEqual([first]);
    act(() => {
      observerOf("Ролик 1").show(false);
      observerOf("Ролик 2").show(true);
    });
    expect(pause.mock.contexts).toContain(first);
    expect(play.mock.contexts.at(-1)).toBe(second);

    const article = screen.getByRole("article", { name: "Reels maker_2" });
    await userEvent.click(within(article).getByRole("button", { name: "Включить звук" }));
    expect(first.muted).toBe(false);
    expect(second.muted).toBe(false);
    expect(screen.getByText("Вы посмотрели все Reels.")).toBeTruthy();
  });

  it("loads the next page when the viewer nears the end", async () => {
    const fetch = api({
      first: { items: [reel(1), reel(2)], nextCursor: "bmV4dA" },
      bmV4dA: { items: [reel(3)], nextCursor: null },
    });
    render(<Reels />);
    await screen.findByLabelText("Ролик 2");
    // The video DOM can appear before its passive effect attaches the observer.
    // Await that observable readiness instead of relying on scheduler speed.
    await waitFor(() => expect(observerOf("Ролик 1")).toBeDefined());
    act(() => observerOf("Ролик 1").show(true));
    expect(await screen.findByLabelText("Ролик 3")).toBeTruthy();
    expect(
      fetch.mock.calls.filter(([input]) => String(input).includes("/api/v1/reels")),
    ).toHaveLength(2);
  });

  it("likes a reel and links to its comments", async () => {
    api({ first: { items: [reel(1)], nextCursor: null } });
    render(<Reels />);
    const article = await screen.findByRole("article", { name: "Reels maker_1" });
    expect(
      within(article).getByRole("link", { name: "Комментарии (1)" }).getAttribute("href"),
    ).toBe(`/p/${uuid(1)}`);
    await userEvent.click(within(article).getByRole("button", { name: "Нравится" }));
    await waitFor(() => expect(within(article).getByText("3")).toBeTruthy());
    expect(within(article).getByRole("button", { name: "Не нравится" })).toBeTruthy();
  });

  it("invites to publish when there are no reels", async () => {
    api({ first: { items: [], nextCursor: null } });
    render(<Reels />);
    expect(await screen.findByRole("heading", { name: "Reels пока нет" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Опубликовать видео" }).getAttribute("href")).toBe(
      "/create",
    );
  });
});
