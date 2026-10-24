import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ShareButton } from "./share-button";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => ({
    id: "00000000-0000-4000-8000-000000000001",
    username: "sender",
    emailVerified: true,
  }),
}));
const user = {
  id: uuid(2),
  username: "receiver",
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
};
const conversation = {
  id: uuid(3),
  peer: user,
  lastMessage: null,
  lastActivityAt: new Date().toISOString(),
};
const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const reply = {
  message: {
    id: uuid(4),
    conversationId: uuid(3),
    senderId: uuid(1),
    clientMessageId: uuid(5),
    text: "",
    createdAt: new Date().toISOString(),
    sharedContent: { kind: "post", status: "unavailable" },
  },
  shareCount: 1,
};
type Handler = (body: RequestInit) => Response | Promise<Response>;
function routes(handlers: Record<string, Handler>) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method} ${url.pathname}`;
    if (key === "GET /api/v1/auth/csrf") return Response.json({ csrfToken });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("sends to a selected conversation, retains the same id after a lost response and uses the server count", async () => {
  const bodies: { clientMessageId: string }[] = [];
  routes({
    "GET /api/v1/direct/conversations": () =>
      Response.json({ items: [conversation], nextCursor: null }),
    [`POST /api/v1/direct/conversations/${uuid(3)}/messages/share`]: (init) => {
      bodies.push(JSON.parse(init.body as string));
      if (bodies.length === 1) throw new TypeError("Synthetic lost response");
      return Response.json(reply, { status: 201 });
    },
  });
  const toggled = vi.fn();
  render(
    <ShareButton kind="post" contentId={uuid(9)} onOpenChange={toggled} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Поделиться" }));
  const modal = screen.getByRole("dialog", { name: "Поделиться" });
  await userEvent.click(
    await within(modal).findByRole("button", { name: "receiver" }),
  );
  await userEvent.click(
    within(modal).getByRole("button", { name: "Отправить" }),
  );
  expect(await within(modal).findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Поделились: 0")).toBeTruthy();
  await userEvent.click(
    within(modal).getByRole("button", { name: "Повторить отправку" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(bodies[0]!.clientMessageId).toBe(bodies[1]!.clientMessageId);
  expect(screen.getByLabelText("Поделились: 1")).toBeTruthy();
  expect(toggled).toHaveBeenCalledWith(false);
});
it("finds a new recipient through search and opens the pair before sharing", async () => {
  let opened = 0,
    shared = 0;
  routes({
    "GET /api/v1/direct/conversations": () =>
      Response.json({ items: [], nextCursor: null }),
    "GET /api/v1/search/users": () =>
      Response.json({ items: [user], nextCursor: null }),
    "POST /api/v1/direct/conversations": () => {
      opened++;
      return Response.json({ conversation });
    },
    [`POST /api/v1/direct/conversations/${uuid(3)}/messages/share`]: () => {
      shared++;
      return Response.json(reply, { status: 201 });
    },
  });
  render(<ShareButton kind="post" contentId={uuid(9)} />);
  await userEvent.click(screen.getByRole("button", { name: "Поделиться" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Найти получателя" }),
    "receiver",
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "receiver" }),
  );
  expect(screen.getByText(/Получатель:/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(opened).toBe(1);
  expect(shared).toBe(1);
});
it("copies a link without a sharing request or counter increment", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const fetch = routes({
    "GET /api/v1/direct/conversations": () =>
      Response.json({ items: [], nextCursor: null }),
  });
  render(<ShareButton kind="story" contentId={uuid(9)} initialCount={3} />);
  fireEvent.click(screen.getByRole("button", { name: "Поделиться" }));
  fireEvent.click(screen.getByRole("button", { name: "Копировать ссылку" }));
  await screen.findByText("Ссылка скопирована. Счётчик не изменён.");
  expect(writeText.mock.calls[0]![0]).toContain(`/stories/${uuid(9)}`);
  expect(screen.getByLabelText("Поделились: 3")).toBeTruthy();
  expect(fetch.mock.calls.some(([, init]) => init.method === "POST")).toBe(
    false,
  );
});
it("keeps a failed share uncounted and prevents double clicks while sending", async () => {
  let finish!: (response: Response) => void;
  let sends = 0;
  routes({
    "GET /api/v1/direct/conversations": () =>
      Response.json({ items: [conversation], nextCursor: null }),
    [`POST /api/v1/direct/conversations/${uuid(3)}/messages/share`]: () => {
      sends++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  render(<ShareButton kind="post" contentId={uuid(9)} />);
  await userEvent.click(screen.getByRole("button", { name: "Поделиться" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "receiver" }),
  );
  const send = screen.getByRole("button", { name: "Отправить" });
  fireEvent.click(send);
  fireEvent.click(send);
  await waitFor(() => expect(sends).toBe(1));
  finish(
    Response.json(
      {
        error: {
          code: "POST_NOT_FOUND",
          message: "Post not found.",
          requestId: uuid(10),
        },
      },
      { status: 404 },
    ),
  );
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Поделились: 0")).toBeTruthy();
});

it("reflects a newly fetched source counter without a page remount", () => {
  const { rerender } = render(
    <ShareButton kind="post" contentId={uuid(9)} initialCount={1} />,
  );
  expect(screen.getByLabelText("Поделились: 1")).toBeTruthy();
  rerender(<ShareButton kind="post" contentId={uuid(9)} initialCount={4} />);
  expect(screen.getByLabelText("Поделились: 4")).toBeTruthy();
});
it("does not show previous recipients as results when a new search fails", async () => {
  routes({
    "GET /api/v1/direct/conversations": () =>
      Response.json({ items: [conversation], nextCursor: null }),
    "GET /api/v1/search/users": () => {
      throw new TypeError("Synthetic network failure");
    },
  });
  render(<ShareButton kind="post" contentId={uuid(9)} />);
  await userEvent.click(screen.getByRole("button", { name: "Поделиться" }));
  await screen.findByRole("button", { name: "receiver" });
  await userEvent.type(
    screen.getByRole("textbox", { name: "Найти получателя" }),
    "someone",
  );
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "receiver" })).toBeNull();
});
