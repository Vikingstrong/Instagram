import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiveAlerts, markBanned } from "./live-alerts";
import { LiveChat } from "./live-chat";
import { ModerationMenu, muteTerm } from "./moderation";

const api = vi.hoisted(() => ({
  restrict: vi.fn(),
  addModerator: vi.fn(),
  comments: vi.fn(),
}));
const path = vi.hoisted(() => ({ value: "/" }));
vi.mock("@/lib/api/lives", () => ({
  createLivesClient: () => api,
}));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));

const hostId = "00000000-0000-4000-8000-000000000001";
const user = {
  id: "00000000-0000-4000-8000-000000000002",
  username: "troll",
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
};
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

beforeEach(() => {
  api.restrict.mockReset().mockResolvedValue(ok({}));
  api.addModerator.mockReset().mockResolvedValue(ok({ items: [] }));
  api.comments.mockReset().mockResolvedValue(ok({ items: [], next: null }));
  sessionStorage.clear();
});

describe("moderation menu", () => {
  it("mutes for a term or for good, bans, and lets only the host appoint", async () => {
    const userEv = userEvent.setup();
    const onDone = vi.fn();
    const { rerender } = render(
      <ModerationMenu moderation={{ hostId, role: "host" }} user={user} onDone={onDone} />,
    );
    await userEv.click(screen.getByRole("button", { name: "Модерация troll" }));
    await userEv.click(screen.getByRole("menuitem", { name: "Мут на 1 час" }));
    expect(api.restrict).toHaveBeenLastCalledWith(hostId, {
      kind: "mute",
      userId: user.id,
      minutes: 60,
    });
    await userEv.click(screen.getByRole("button", { name: "Модерация troll" }));
    await userEv.click(screen.getByRole("menuitem", { name: "Мут навсегда" }));
    expect(api.restrict).toHaveBeenLastCalledWith(hostId, {
      kind: "mute",
      userId: user.id,
      minutes: null,
    });
    await userEv.click(screen.getByRole("button", { name: "Модерация troll" }));
    await userEv.click(screen.getByRole("menuitem", { name: "Заблокировать" }));
    expect(api.restrict).toHaveBeenLastCalledWith(hostId, { kind: "ban", userId: user.id });
    expect(onDone).toHaveBeenLastCalledWith("troll заблокирован(а)");
    await userEv.click(screen.getByRole("button", { name: "Модерация troll" }));
    await userEv.click(screen.getByRole("menuitem", { name: "Назначить модератором" }));
    expect(api.addModerator).toHaveBeenCalledWith(hostId, user.id);

    rerender(<ModerationMenu moderation={{ hostId, role: "moderator" }} user={user} />);
    expect(screen.queryByRole("menuitem", { name: "Назначить модератором" })).toBeNull();
  });

  it("shows the API refusal in the menu", async () => {
    api.restrict.mockResolvedValue({
      ok: false,
      failure: {
        kind: "api",
        status: 403,
        error: { code: "LIVE_MODERATION_FORBIDDEN", message: "x", requestId: "r" },
      },
    });
    const userEv = userEvent.setup();
    render(<ModerationMenu moderation={{ hostId, role: "moderator" }} user={user} />);
    await userEv.click(screen.getByRole("button", { name: "Модерация troll" }));
    await userEv.click(screen.getByRole("menuitem", { name: "Мут на 5 минут" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Недостаточно прав");
  });
});

describe("mute and ban states", () => {
  it("blocks writing for a muted viewer with the term", async () => {
    render(<LiveChat liveId={hostId} open muted={{ until: null }} />);
    expect(await screen.findByText("Вам запрещено писать в этом эфире навсегда.")).toBeTruthy();
    expect(screen.queryByLabelText("Комментарий к эфиру")).toBeNull();
    expect(muteTerm({ until: "2026-10-24T13:05:00.000Z" })).toMatch(/^до \d\d:\d\d$/);
  });

  it("tells a banned user on the home page once", async () => {
    markBanned();
    const { unmount } = render(<LiveAlerts />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Вас забанили на трансляции",
    );
    unmount();
    render(<LiveAlerts />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
