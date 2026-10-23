import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadWithProgress } from "@/lib/api/upload";
import { replaceLocation } from "@/lib/navigation";

import { CreatePost } from "./create-post";

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
vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));
vi.mock("@/lib/api/upload", () => ({ uploadWithProgress: vi.fn() }));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const videoPost = (status: "processing" | "ready" | "failed") => ({
  id: uuid(1),
  author: {
    id: viewer.id,
    username: "person",
    displayName: "",
    avatarUrl: null,
    isPrivate: false,
  },
  caption: "Закат",
  type: "video",
  image: {
    url: `/api/v1/media/${uuid(9)}/full`,
    thumbnailUrl: `/api/v1/media/${uuid(9)}/thumb`,
    width: 1080,
    height: 608,
  },
  video:
    status === "ready" ? { url: `/api/v1/media/${uuid(9)}/video`, durationMs: 2000 } : null,
  status,
  createdAt: "2026-10-24T10:00:00.000Z",
  likeCount: 0,
  commentCount: 0,
  liked: false,
});
const clip = (size = 2048, type = "video/mp4") => {
  const file = new File([new Uint8Array(16)], "clip.mp4", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

// GET /api/v1/posts/{id} answers with the given statuses in turn.
function api(statuses: ("processing" | "ready" | "failed")[]) {
  const fetch = vi.fn(async (input: string) => {
    const path = new URL(input, "http://localhost").pathname;
    if (path === "/api/v1/auth/csrf") return Response.json({ csrfToken });
    if (path === `/api/v1/posts/${uuid(1)}`)
      return Response.json({ post: videoPost(statuses.shift() ?? "ready") });
    throw new Error(`Unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(replaceLocation).mockClear();
  vi.mocked(uploadWithProgress).mockReset();
});

describe("create video post", () => {
  it("uploads with progress, waits for processing and opens the post", async () => {
    api(["processing", "ready"]);
    let finish!: () => void;
    vi.mocked(uploadWithProgress).mockImplementation(async (request) => {
      expect(request.endpoint.path).toBe("/api/v1/posts/video");
      expect(request.csrfToken).toBe(csrfToken);
      expect(request.form.get("video")).toBeInstanceOf(File);
      expect(request.form.get("caption")).toBe("Закат");
      request.onProgress?.(0.4);
      await new Promise<void>((resolve) => (finish = resolve));
      return { ok: true, status: 201, data: { post: videoPost("processing") } } as never;
    });
    render(<CreatePost />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Фото или видео для публикации"), clip());
    expect(screen.getByLabelText("Выбранное видео").getAttribute("src")).toBe("blob:preview");
    await user.type(screen.getByRole("textbox", { name: "Подпись" }), "Закат");
    await user.click(screen.getByRole("button", { name: "Поделиться" }));
    expect(await screen.findByText("Загрузка… 40%")).toBeTruthy();
    finish();
    expect(await screen.findByText(/Обрабатываем видео/)).toBeTruthy();
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith(`/p/${uuid(1)}`), {
      timeout: 6000,
    });
  }, 10_000);

  it("tells the author when processing failed and lets them pick another file", async () => {
    api(["failed"]);
    vi.mocked(uploadWithProgress).mockResolvedValue({
      ok: true,
      status: 201,
      data: { post: videoPost("processing") },
    } as never);
    render(<CreatePost />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Фото или видео для публикации"), clip());
    await user.click(screen.getByRole("button", { name: "Поделиться" }));
    expect(
      (await screen.findByText(/Не удалось обработать видео/, {}, { timeout: 4000 })).textContent,
    ).toBe("Не удалось обработать видео. Попробуйте другой файл.");
    expect(
      (screen.getByRole("button", { name: "Выбрать другой файл" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(replaceLocation).not.toHaveBeenCalled();
  }, 10_000);

  it("refuses an oversize or unsupported video before uploading", async () => {
    api([]);
    render(<CreatePost />);
    const user = userEvent.setup({ applyAccept: false });
    const field = screen.getByLabelText("Фото или видео для публикации");
    await user.upload(field, clip(100 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert").textContent).toBe(
      "Видео больше 100 МБ. Выберите файл поменьше.",
    );
    await user.upload(field, clip(2048, "video/x-msvideo"));
    expect(screen.getByRole("alert").textContent).toBe(
      "Выберите фото (JPEG, PNG, WebP) или видео (MP4, MOV, WebM).",
    );
    expect(uploadWithProgress).not.toHaveBeenCalled();
  });

  it("keeps the video and caption after a failed upload for a retry", async () => {
    api([]);
    vi.mocked(uploadWithProgress).mockResolvedValue({
      ok: false,
      failure: {
        kind: "api",
        status: 400,
        error: {
          code: "VIDEO_TOO_LONG",
          message: "The video is longer than allowed.",
          requestId: "8f4c5d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f",
        },
      },
    } as never);
    render(<CreatePost />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Фото или видео для публикации"), clip());
    await user.click(screen.getByRole("button", { name: "Поделиться" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Видео длиннее 90 секунд. Обрежьте его и попробуйте снова.",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    expect(screen.getByLabelText("Выбранное видео")).toBeTruthy();
  });
});
