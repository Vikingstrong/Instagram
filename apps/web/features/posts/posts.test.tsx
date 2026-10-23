import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileSettings } from "@/features/settings/profile-settings";
import { replaceLocation } from "@/lib/navigation";

import { CreatePost } from "./create-post";
import { PostView } from "./post-view";
import { ProfileGrid } from "./profile-grid";

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
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: route.id }),
  usePathname: () => "/accounts/edit",
}));
vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = (id = viewer.id, username = "person") => ({
  id,
  username,
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
});
const post = (n: number, extra: object = {}) => ({
  id: uuid(n),
  author: author(),
  caption: `Пост ${n}`,
  image: {
    url: `/api/v1/media/${uuid(100 + n)}/full`,
    thumbnailUrl: `/api/v1/media/${uuid(100 + n)}/thumb`,
    width: 1080,
    height: 1080,
  },
  createdAt: "2026-10-23T10:00:00.000Z",
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
const photo = (type = "image/png", size = 1024) =>
  new File([new Uint8Array(size)], "photo.png", { type });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(replaceLocation).mockClear();
});

describe("create post", () => {
  it("rejects a wrong file before uploading", async () => {
    const fetch = api({});
    render(<CreatePost />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText("Фото для публикации"), photo("image/gif"));
    expect(screen.getByRole("alert").textContent).toBe(
      "Выберите фото в формате JPEG, PNG или WebP.",
    );
    await user.upload(
      screen.getByLabelText("Фото для публикации"),
      photo("image/jpeg", 10 * 1024 * 1024 + 1),
    );
    expect(screen.getByRole("alert").textContent).toBe("Фото больше 10 МБ. Выберите файл поменьше.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the photo with its caption, keeps them after a failure and opens the post", async () => {
    let fail = true;
    let sent: FormData | undefined;
    api({
      "POST /api/v1/posts": (_url, init) => {
        sent = init.body as FormData;
        return fail
          ? Response.json(errorBody("INVALID_IMAGE", "The image is damaged or its format is not supported."), { status: 400 })
          : Response.json({ post: post(1) }, { status: 201 });
      },
    });
    render(<CreatePost />);
    const user = userEvent.setup();
    const file = photo();
    await user.upload(screen.getByLabelText("Фото для публикации"), file);
    expect(screen.getByRole("img", { name: "Выбранное фото" }).getAttribute("src")).toBe("blob:preview");
    await user.type(screen.getByRole("textbox", { name: "Подпись" }), "Закат");
    await user.click(screen.getByRole("button", { name: "Поделиться" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Файл повреждён или это не JPEG, PNG или WebP.",
    );
    expect(sent?.get("image")).toBe(file);
    expect(sent?.get("caption")).toBe("Закат");
    expect((screen.getByRole("textbox", { name: "Подпись" }) as HTMLTextAreaElement).value).toBe("Закат");

    fail = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith(`/p/${uuid(1)}`));
  });

  it("blocks a caption over 2200 characters", async () => {
    api({});
    render(<CreatePost />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Фото для публикации"), photo());
    await user.click(screen.getByRole("textbox", { name: "Подпись" }));
    await user.paste("x".repeat(2201));
    expect((screen.getByRole("button", { name: "Поделиться" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("post details", () => {
  it("shows the protected image and lets the author delete after confirmation", async () => {
    route.id = uuid(1);
    let deleted = false;
    api({
      [`GET /api/v1/posts/${uuid(1)}`]: () => Response.json({ post: post(1) }),
      [`DELETE /api/v1/posts/${uuid(1)}`]: () => {
        deleted = true;
        return Response.json({ status: "deleted" });
      },
    });
    render(<PostView />);
    const user = userEvent.setup();
    const image = await screen.findByRole("img", { name: "Пост 1" });
    expect(image.getAttribute("src")).toBe(post(1).image.url);
    await user.click(screen.getAllByRole("button", { name: "Удалить публикацию" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Удалить публикацию?" });
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(deleted).toBe(false);
    await user.click(screen.getAllByRole("button", { name: "Удалить публикацию" })[0]);
    await user.click(
      within(screen.getByRole("dialog", { name: "Удалить публикацию?" })).getByRole("button", {
        name: "Удалить",
      }),
    );
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/person"));
    expect(deleted).toBe(true);
  });

  it("offers no deletion to other viewers and hides missing posts", async () => {
    route.id = uuid(2);
    api({
      [`GET /api/v1/posts/${uuid(2)}`]: () =>
        Response.json({ post: post(2, { author: author(uuid(9), "other") }) }),
    });
    const { unmount } = render(<PostView />);
    expect(await screen.findByRole("img", { name: "Пост 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Удалить публикацию" })).toBeNull();
    unmount();

    route.id = uuid(3);
    api({
      [`GET /api/v1/posts/${uuid(3)}`]: () =>
        Response.json(errorBody("POST_NOT_FOUND", "Post not found."), { status: 404 }),
    });
    render(<PostView />);
    expect(await screen.findByRole("heading", { name: "Публикация недоступна" })).toBeTruthy();
  });
});

describe("profile grid", () => {
  it("shows thumbnails linking to posts and loads more", async () => {
    const fetch = api({
      [`GET /api/v1/users/${viewer.id}/posts`]: (url) =>
        Response.json(
          url.searchParams.get("cursor")
            ? { items: [post(3)], nextCursor: null }
            : { items: [post(1), post(2)], nextCursor: "bmV4dA" },
        ),
    });
    render(<ProfileGrid userId={viewer.id} self />);
    const first = await screen.findByRole("link", { name: "Пост 1" });
    expect(first.getAttribute("href")).toBe(`/p/${uuid(1)}`);
    expect(within(first).getByRole("img").getAttribute("src")).toBe(post(1).image.thumbnailUrl);
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByRole("link", { name: "Пост 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("invites the owner to share a first photo", async () => {
    api({
      [`GET /api/v1/users/${viewer.id}/posts`]: () => Response.json({ items: [], nextCursor: null }),
    });
    render(<ProfileGrid userId={viewer.id} self />);
    expect(
      (await screen.findByRole("link", { name: "Поделитесь своим первым фото" })).getAttribute("href"),
    ).toBe("/create");
  });
});

describe("profile photo", () => {
  it("uploads a new photo, shows it and can remove it", async () => {
    const avatar = `/api/v1/media/${uuid(50)}/thumb`;
    let profile = { ...author(), bio: "", avatarUrl: null as string | null };
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile }),
      "PUT /api/v1/me/avatar": (_url, init) => {
        expect((init.body as FormData).get("image")).toBeInstanceOf(File);
        profile = { ...profile, avatarUrl: avatar };
        return Response.json({ avatarUrl: avatar });
      },
      "DELETE /api/v1/me/avatar": () => Response.json({ avatarUrl: null }),
    });
    const { container } = render(<ProfileSettings />);
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Имя" });
    await user.type(name, "Черновик");
    await user.upload(screen.getByLabelText("Фото профиля"), photo());
    await waitFor(() => expect(container.querySelector(`img[src="${avatar}"]`)).toBeTruthy());
    // Unsaved text survives the photo change.
    expect((screen.getByRole("textbox", { name: "Имя" }) as HTMLInputElement).value).toBe("Черновик");
    await user.click(screen.getByRole("button", { name: "Удалить фото" }));
    await waitFor(() => expect(container.querySelector("img")).toBeNull());
  });
});
