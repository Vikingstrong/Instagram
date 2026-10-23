import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Feed } from "./feed";
import { PostView } from "./post-view";
import { timeAgo } from "./time";

const viewer = {
  id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789",
  email: "person@example.test",
  username: "person",
  emailVerified: true,
};
const route = vi.hoisted(() => ({ id: "" }));
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => viewer,
  useHomeChecking: () => false,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: route.id }) }));
vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (n: number, username = `user_${n}`) => ({
  id: uuid(900 + n),
  username,
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
});
const post = (n: number, extra: object = {}) => ({
  id: uuid(n),
  author: user(n),
  caption: `Пост ${n}`,
  type: "photo",
  video: null,
  status: "ready",
  image: {
    url: `/api/v1/media/${uuid(100 + n)}/full`,
    thumbnailUrl: `/api/v1/media/${uuid(100 + n)}/thumb`,
    width: 1080,
    height: 1080,
  },
  createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  likeCount: 4,
  commentCount: 0,
  liked: false,
  ...extra,
});
const comment = (n: number, extra: object = {}) => ({
  id: uuid(500 + n),
  postId: uuid(1),
  author: user(n),
  text: `Комментарий ${n}`,
  createdAt: new Date().toISOString(),
  canDelete: false,
  ...extra,
});
const errorBody = (code: string, message: string) => ({
  error: { code, message, requestId: "8f4c5d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f" },
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function api(routes: Record<string, Handler>) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method} ${url.pathname}`;
    if (key === "GET /api/v1/auth/csrf") return Response.json({ csrfToken });
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("feed", () => {
  it("shows posts newest first and loads the next page", async () => {
    api({
      "GET /api/v1/feed": (url) =>
        Response.json(
          url.searchParams.get("cursor")
            ? { items: [post(3)], nextCursor: null }
            : { items: [post(1), post(2)], nextCursor: "bmV4dA" },
        ),
    });
    render(<Feed viewerId={viewer.id} />);
    const feed = await screen.findByRole("region", { name: "Лента" });
    const articles = within(feed).getAllByRole("article");
    expect(articles.map((item) => item.getAttribute("aria-labelledby"))).toEqual([
      `post-${uuid(1)}`,
      `post-${uuid(2)}`,
    ]);
    expect(within(articles[0]!).getByRole("img", { name: "Пост 1" }).getAttribute("src")).toBe(
      post(1).image.url,
    );
    expect(within(articles[0]!).getByText("2 ч.")).toBeTruthy();
    expect(within(articles[0]!).getByText("4 отметки «Нравится»")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByRole("img", { name: "Пост 3" })).toBeTruthy();
    expect(screen.getByText("Вы всё посмотрели.")).toBeTruthy();
  });

  it("explains an empty feed", async () => {
    api({ "GET /api/v1/feed": () => Response.json({ items: [], nextCursor: null }) });
    render(<Feed viewerId={viewer.id} />);
    expect(await screen.findByRole("heading", { name: "В ленте пока пусто" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Найти людей" }).getAttribute("href")).toBe("/search");
  });

  it("likes at once, keeps the server state and rolls back a refused like", async () => {
    let answer = deferred();
    api({
      "GET /api/v1/feed": () => Response.json({ items: [post(1)], nextCursor: null }),
      [`PUT /api/v1/posts/${uuid(1)}/like`]: () => answer.promise,
      [`DELETE /api/v1/posts/${uuid(1)}/like`]: () =>
        Response.json(errorBody("POST_NOT_FOUND", "Post not found."), { status: 404 }),
    });
    render(<Feed viewerId={viewer.id} />);
    const like = await screen.findByRole("button", { name: "Нравится" });
    await userEvent.click(like);
    // Optimistic: changed before the server answers.
    expect(screen.getByRole("button", { name: "Не нравится" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("5 отметок «Нравится»")).toBeTruthy();
    answer.resolve(Response.json({ liked: true, likeCount: 9 }));
    expect(await screen.findByText("9 отметок «Нравится»")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Не нравится" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Публикация недоступна или удалена.");
    expect(screen.getByRole("button", { name: "Не нравится" })).toBeTruthy();
    expect(screen.getByText("9 отметок «Нравится»")).toBeTruthy();
    answer = deferred();
  });

  it("adds a comment with Enter, keeps text on failure and counts it", async () => {
    let fail = true;
    let sent: unknown;
    api({
      "GET /api/v1/feed": () =>
        Response.json({ items: [post(1, { commentCount: 2 })], nextCursor: null }),
      [`POST /api/v1/posts/${uuid(1)}/comments`]: (_url, init) => {
        sent = JSON.parse(String(init.body));
        return fail
          ? Response.json(errorBody("TOO_MANY_REQUESTS", "Too many requests. Try again later."), {
              status: 429,
            })
          : Response.json(
              { comment: comment(7, { author: user(0, "person"), text: "Класс", canDelete: true }) },
              { status: 201 },
            );
      },
    });
    render(<Feed viewerId={viewer.id} />);
    const field = await screen.findByRole("textbox", { name: "Комментарий" });
    expect(screen.getByRole("link", { name: "Посмотреть все комментарии (2)" })).toBeTruthy();
    await userEvent.type(field, "   ");
    expect((screen.getByRole("button", { name: "Опубликовать" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, "Класс{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("Слишком много запросов. Попробуйте позже.");
    expect((field as HTMLTextAreaElement).value).toBe("Класс");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(await screen.findByText("Класс")).toBeTruthy();
    expect(sent).toEqual({ text: "Класс" });
    expect((field as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("link", { name: "Посмотреть все комментарии (3)" })).toBeTruthy();
  });
});

describe("post comments", () => {
  it("lists comments, deletes after confirmation and never repeats an added one", async () => {
    route.id = uuid(1);
    let deleted = "";
    api({
      [`GET /api/v1/posts/${uuid(1)}`]: () => Response.json({ post: post(1, { commentCount: 3 }) }),
      [`GET /api/v1/posts/${uuid(1)}/comments`]: (url) =>
        Response.json(
          url.searchParams.get("cursor")
            ? { items: [comment(3), comment(9, { canDelete: true })], nextCursor: null }
            : { items: [comment(1), comment(2, { canDelete: true })], nextCursor: "bmV4dA" },
        ),
      [`POST /api/v1/posts/${uuid(1)}/comments`]: () =>
        Response.json({ comment: comment(9, { canDelete: true }) }, { status: 201 }),
      [`DELETE /api/v1/comments/${uuid(502)}`]: () => {
        deleted = uuid(502);
        return Response.json({ status: "deleted" });
      },
    });
    render(<PostView />);
    const list = await screen.findByRole("region", { name: "Комментарии" });
    await within(list).findByText("Комментарий 1");
    expect(within(list).queryByRole("button", { name: "Удалить комментарий user_1" })).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Комментарий" }), "Комментарий 9{Enter}");
    await within(list).findByText("Комментарий 9");
    await user.click(within(list).getByRole("button", { name: "Показать ещё комментарии" }));
    await within(list).findByText("Комментарий 3");
    expect(within(list).getAllByText("Комментарий 9")).toHaveLength(1);
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent?.match(/Комментарий \d/)?.[0]),
    ).toEqual(["Комментарий 1", "Комментарий 2", "Комментарий 3", "Комментарий 9"]);

    await user.click(within(list).getByRole("button", { name: "Удалить комментарий user_2" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить комментарий?" });
    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(within(list).queryByText("Комментарий 2")).toBeNull());
    expect(deleted).toBe(uuid(502));
  });
});

it("formats post age like Instagram", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");
  expect(timeAgo("2026-10-23T11:59:40.000Z", now)).toBe("только что");
  expect(timeAgo("2026-10-23T11:15:00.000Z", now)).toBe("45 мин.");
  expect(timeAgo("2026-10-23T02:00:00.000Z", now)).toBe("10 ч.");
  expect(timeAgo("2026-10-20T12:00:00.000Z", now)).toBe("3 д.");
  expect(timeAgo("2026-09-01T12:00:00.000Z", now)).toBe("1 сентября 2026 г.");
});
