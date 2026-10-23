import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateStory } from "./create-story";
import { StoryViewer } from "./story-viewer";
import { StoryTray } from "./story-tray";
const route = vi.hoisted(() => ({
  id: "00000000-0000-4000-8000-000000000001",
  push: vi.fn(),
  replace: vi.fn(),
}));
const router = { push: route.push, replace: route.replace };
const user = {
  id: "00000000-0000-4000-8000-000000000010",
  username: "owner",
  email: "owner@example.test",
  emailVerified: true,
};
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => user,
  useHomeChecking: () => false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ id: route.id }),
}));
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const story = (n = 1, extra = {}) => ({
  id: uuid(n),
  author: {
    id: user.id,
    username: user.username,
    displayName: "",
    avatarUrl: null,
    isPrivate: false,
  },
  type: "photo",
  status: "ready",
  image: {
    url: `/api/v1/media/${uuid(n + 100)}/full`,
    thumbnailUrl: `/api/v1/media/${uuid(n + 100)}/thumb`,
    width: 800,
    height: 1200,
  },
  video: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  viewed: false,
  ...extra,
});
const errorBody = {
  error: {
    code: "STORY_NOT_FOUND",
    message: "Story is unavailable or expired.",
    requestId: uuid(999),
  },
};
function api(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/v1/auth/csrf")
      return Response.json({
        csrfToken: `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`,
      });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  route.push.mockReset();
  route.replace.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:story"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Stories creation", () => {
  it("rejects invalid files before uploading", async () => {
    const fetch = api(() => {
      throw new Error("unexpected");
    });
    render(<CreateStory />);
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        screen.getByLabelText("Фото или видео для истории"),
        new File(["x"], "bad.gif", { type: "image/gif" }),
      );
    expect(screen.getByRole("alert").textContent).toContain(
      "JPEG, PNG или WebP",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the photo after a network failure, retries multipart and opens the published story", async () => {
    let fail = true;
    const fetch = api((_url, init) => {
      expect(init.body).toBeInstanceOf(FormData);
      expect(
        (init.headers as Record<string, string>)["X-CSRF-Token"],
      ).toBeTruthy();
      if (fail) throw new Error("offline");
      return Response.json({ story: story() }, { status: 201 });
    });
    render(<CreateStory />);
    const actions = userEvent.setup();
    await actions.upload(
      screen.getByLabelText("Фото или видео для истории"),
      new File(["photo"], "photo.png", { type: "image/png" }),
    );
    await actions.click(
      screen.getByRole("button", { name: "Опубликовать историю" }),
    );
    expect(screen.getByRole("alert").textContent).toContain("Нет соединения");
    expect(screen.getByRole("img", { name: "Выбранное фото" })).toBeTruthy();
    fail = false;
    await actions.click(
      screen.getByRole("button", { name: "Опубликовать историю" }),
    );
    expect(route.push).toHaveBeenCalledWith(`/stories/${uuid(1)}`);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
it("does not navigate after leaving while a story upload is pending", async () => {
  let release!: (response: Response) => void;
  let uploadSignal: AbortSignal | null | undefined;
  api((_url, init) => {
    uploadSignal = init.signal;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const view = render(<CreateStory />);
  const actions = userEvent.setup();
  await actions.upload(
    screen.getByLabelText("Фото или видео для истории"),
    new File(["photo"], "photo.png", { type: "image/png" }),
  );
  await actions.click(
    screen.getByRole("button", { name: "Опубликовать историю" }),
  );
  view.unmount();
  expect(uploadSignal?.aborted).toBe(true);
  await act(async () => {
    release(Response.json({ story: story() }, { status: 201 }));
  });
  expect(route.push).not.toHaveBeenCalled();
});

describe("Story viewer", () => {
  function setup(extra = {}) {
    const one = story(1, extra),
      two = story(2);
    const fetch = api((url, init) => {
      if (init.method === "POST") return Response.json({ status: "viewed" });
      if (url.pathname.endsWith("/viewers"))
        return Response.json({ items: [], total: 0, nextCursor: null });
      if (url.pathname.includes("/users/"))
        return Response.json({ items: [one, two], nextCursor: null });
      return Response.json({ story: one });
    });
    return { one, fetch };
  }
  it("marks a photo only after load, once, and pauses while the audience is open", async () => {
    const { fetch } = setup();
    render(<StoryViewer />);
    const image = await screen.findByRole("img", { name: "История owner" });
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/views")),
    ).toHaveLength(0);
    fireEvent.load(image);
    fireEvent.load(image);
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([url]) => url.endsWith("/views")),
      ).toHaveLength(1),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Зрители" }));
    expect(
      await screen.findByText("Пока никто не посмотрел историю."),
    ).toBeTruthy();
  });
  it("advances photos after five visible seconds and preserves progress across pause", async () => {
    vi.useFakeTimers();
    setup();
    render(<StoryViewer />);
    await act(async () => {});
    fireEvent.load(screen.getByRole("img", { name: "История owner" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Приостановить историю" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(route.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Продолжить историю" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(route.replace).toHaveBeenCalledWith(`/stories/${uuid(2)}`);
  });
  it("removes media when the lifetime expires without waiting for the server cleanup", async () => {
    vi.useFakeTimers();
    setup({ expiresAt: new Date(Date.now() + 1000).toISOString() });
    render(<StoryViewer />);
    await act(async () => {});
    expect(screen.getByRole("img", { name: "История owner" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.queryByRole("img", { name: "История owner" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("истёк");
  });
  it("clears a revoked story after access revalidation", async () => {
    let revoked = false;
    const one = story();
    api((url) =>
      url.pathname.includes("/users/")
        ? Response.json({ items: [one], nextCursor: null })
        : revoked
          ? Response.json(errorBody, { status: 404 })
          : Response.json({ story: one }),
    );
    render(<StoryViewer />);
    await screen.findByRole("img", { name: "История owner" });
    revoked = true;
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "История owner" })).toBeNull(),
    );
    expect(screen.getByRole("alert").textContent).toContain("недоступна");
  });
  it("polls a processing video and switches to playback only when ready", async () => {
    vi.useFakeTimers();
    let ready = false;
    const one = story(1, { type: "video", status: "processing" });
    api((url) =>
      url.pathname.includes("/users/")
        ? Response.json({ items: [one], nextCursor: null })
        : Response.json({
            story: ready
              ? {
                  ...one,
                  status: "ready",
                  video: {
                    url: `/api/v1/media/${uuid(101)}/video`,
                    durationMs: 1000,
                  },
                }
              : one,
          }),
    );
    render(<StoryViewer />);
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain(
      "Обрабатываем видео",
    );
    ready = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByLabelText("Видео истории")).toBeTruthy();
  });
});
it("shows real author rings and creation link in the home tray", async () => {
  api(() =>
    Response.json({
      items: [
        {
          author: story().author,
          latestAt: new Date().toISOString(),
          hasUnseen: true,
        },
      ],
      nextCursor: null,
    }),
  );
  render(<StoryTray />);
  expect(
    screen.getByRole("link", { name: /Ваша история/ }).getAttribute("href"),
  ).toBe("/stories/create");
  expect(
    (
      await screen.findByRole("link", { name: "Истории owner, новые" })
    ).getAttribute("href"),
  ).toBe(`/stories/user/${user.id}`);
});
