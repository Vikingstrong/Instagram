import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { SaveButton } from "./save-button";

const save = vi.fn();
const unsave = vi.fn();
vi.mock("@/lib/api/posts", () => ({
  createPostsClient: () => ({ save, unsave }),
}));

beforeEach(() => {
  save.mockReset();
  unsave.mockReset();
});

it("saves and unsaves through the API", async () => {
  save.mockResolvedValue({ ok: true, data: { saved: true } });
  unsave.mockResolvedValue({ ok: true, data: { saved: false } });
  render(<SaveButton postId="p1" />);
  await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(save).toHaveBeenCalledWith("p1");
  const saved = screen.getByRole("button", { name: "Удалить из сохранённого" });
  expect(saved.getAttribute("aria-pressed")).toBe("true");
  await userEvent.click(saved);
  expect(unsave).toHaveBeenCalledWith("p1");
  expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
});

it("rolls back when the server refuses", async () => {
  save.mockResolvedValue({ ok: false, failure: { kind: "network" } });
  render(<SaveButton postId="p1" />);
  await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Сохранить" }).getAttribute("title"),
    ).toMatch(/Не удалось/),
  );
});
