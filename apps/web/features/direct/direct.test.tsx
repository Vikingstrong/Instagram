import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Inbox } from "./inbox";
import { MessageButton } from "./message-button";
import { Thread } from "./thread";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const me = "4f70d2ab-d6d6-4243-b0d3-f7b767434789";
const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const conversationId = uuid(1);
const peer = {
  id: uuid(2),
  username: "friend",
  displayName: "Друг",
  avatarUrl: null,
  isPrivate: true,
};
const at = (minute: number) => new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString();
const message = (n: number, senderId = peer.id, extra: object = {}) => ({
  id: uuid(100 + n),
  conversationId,
  senderId,
  clientMessageId: uuid(200 + n),
  text: `m${n}`,
  createdAt: at(n),
  ...extra,
});
const conversation = (extra: object = {}) => ({
  id: conversationId,
  peer,
  lastMessage: null,
  lastActivityAt: at(0),
  ...extra,
});
const errorBody = (code: string, text: string) => ({
  error: { code, message: text, requestId: "8f4c5d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f" },
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
const texts = () =>
  within(screen.getByRole("list", { name: "Сообщения" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent?.replace(/(Отправка…|Не отправлено.*)$/, ""));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("inbox", () => {
  it("lists conversations with the peer and a preview of the last message", async () => {
    api({
      "GET /api/v1/direct/conversations": () =>
        Response.json({
          items: [
            conversation({ lastMessage: message(1, me, { text: "увидимся" }), lastActivityAt: at(1) }),
            conversation({ id: uuid(3), peer: { ...peer, id: uuid(4), username: "other", displayName: "" } }),
          ],
          nextCursor: null,
        }),
    });
    render(<Inbox viewerId={me} username="person" selectedId={conversationId} version={0} />);
    const nav = screen.getByRole("navigation", { name: "Диалоги" });
    const first = await within(nav).findByRole("link", { name: /Друг/ });
    expect(first.getAttribute("href")).toBe(`/direct/t/${conversationId}`);
    expect(first.getAttribute("aria-current")).toBe("page");
    expect(first.textContent).toContain("Вы: увидимся");
    expect(within(nav).getByRole("link", { name: /other/ }).textContent).toContain("Начните диалог");
  });

  it("explains how to start when there are no conversations", async () => {
    api({ "GET /api/v1/direct/conversations": () => Response.json({ items: [], nextCursor: null }) });
    render(<Inbox viewerId={me} username="person" version={0} />);
    expect(await screen.findByText(/Откройте профиль и нажмите «Написать»/)).toBeTruthy();
  });
});

const threadProps = {
  conversationId,
  viewerId: me,
  syncKey: 0,
  connection: "live" as const,
  onActivity: () => {},
};

describe("conversation", () => {
  function routes(extra: Record<string, Handler>) {
    return {
      [`GET /api/v1/direct/conversations/${conversationId}`]: () =>
        Response.json({ conversation: conversation() }),
      ...extra,
    };
  }

  it("shows history oldest first and loads older pages", async () => {
    api(
      routes({
        [`GET /api/v1/direct/conversations/${conversationId}/messages`]: (url) =>
          Response.json(
            url.searchParams.get("cursor")
              ? { items: [message(1)], nextCursor: null }
              : { items: [message(3, me), message(2)], nextCursor: "b2xkZXI" },
          ),
      }),
    );
    render(<Thread {...threadProps} />);
    expect(await screen.findByRole("region", { name: "Диалог с friend" })).toBeTruthy();
    await screen.findByText("m3");
    expect(texts()).toEqual(["m2", "m3"]);
    await userEvent.click(screen.getByRole("button", { name: "Показать предыдущие сообщения" }));
    await screen.findByText("m1");
    expect(texts()).toEqual(["m1", "m2", "m3"]);
    expect(screen.queryByRole("button", { name: "Показать предыдущие сообщения" })).toBeNull();
  });

  it("shows a pending message, retries a failed send with the same id and never duplicates it", async () => {
    const sent: { clientMessageId: string; text: string }[] = [];
    let attempts = 0;
    let stored: ReturnType<typeof message> | undefined;
    const onActivity = vi.fn();
    api(
      routes({
        [`GET /api/v1/direct/conversations/${conversationId}/messages`]: () =>
          Response.json({ items: stored ? [stored] : [], nextCursor: null }),
        [`POST /api/v1/direct/conversations/${conversationId}/messages`]: (_url, init) => {
          const body = JSON.parse(String(init.body)) as { clientMessageId: string; text: string };
          sent.push(body);
          attempts += 1;
          // The first attempt is stored but its answer is lost.
          stored = message(5, me, { clientMessageId: body.clientMessageId, text: body.text });
          if (attempts === 1)
            return Response.json(errorBody("SERVICE_UNAVAILABLE", "Service is temporarily unavailable."), {
              status: 503,
            });
          return Response.json({ message: stored }, { status: 201 });
        },
      }),
    );
    const view = render(<Thread {...threadProps} onActivity={onActivity} />);
    const user = userEvent.setup();
    expect(await screen.findByText("Напишите первое сообщение.")).toBeTruthy();
    const field = screen.getByRole("textbox", { name: "Сообщение" });
    await user.type(field, "   ");
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(field);
    await user.type(field, "Привет{Enter}");
    expect((field as HTMLTextAreaElement).value).toBe("");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не отправлено. Сервис временно недоступен. Попробуйте позже.",
    );

    // A sync (stream notice) already brings the stored copy; retry must not
    // add another one.
    view.rerender(<Thread {...threadProps} onActivity={onActivity} syncKey={1} />);
    await screen.findByText("Привет", { selector: "li > div:not(.opacity-60)" });
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(texts()).toEqual(["Привет"]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it("can drop an unsent message", async () => {
    api(
      routes({
        [`GET /api/v1/direct/conversations/${conversationId}/messages`]: () =>
          Response.json({ items: [], nextCursor: null }),
        [`POST /api/v1/direct/conversations/${conversationId}/messages`]: () =>
          Response.json(errorBody("TOO_MANY_REQUESTS", "Too many requests. Try again later."), { status: 429 }),
      }),
    );
    render(<Thread {...threadProps} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Сообщение" }), "спам{Enter}");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(screen.queryByText("спам")).toBeNull();
  });

  it("does not reveal another user's conversation", async () => {
    api({
      [`GET /api/v1/direct/conversations/${conversationId}`]: () =>
        Response.json(errorBody("CONVERSATION_NOT_FOUND", "Conversation not found."), { status: 404 }),
    });
    render(<Thread {...threadProps} />);
    expect(await screen.findByRole("heading", { name: "Диалог не найден" })).toBeTruthy();
  });
});

it("opens the conversation from a profile", async () => {
  let body: unknown;
  api({
    "POST /api/v1/direct/conversations": (_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ conversation: conversation() });
    },
  });
  render(<MessageButton userId={peer.id} />);
  await userEvent.click(screen.getByRole("button", { name: "Написать" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith(`/direct/t/${conversationId}`));
  expect(body).toEqual({ userId: peer.id });
});
