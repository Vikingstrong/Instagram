import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNav } from "./bottom-nav";
import { isNavItemActive, navItems } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";
import { MobileHeader } from "./mobile-header";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("isNavItemActive", () => {
  it("matches home exactly and other sections by prefix", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/direct", "/")).toBe(false);
    expect(isNavItemActive("/direct/42", "/direct")).toBe(true);
    expect(isNavItemActive("/directory", "/direct")).toBe(false);
  });
});

describe("SidebarNav", () => {
  beforeEach(() => {
    navigation.pathname = "/";
  });

  it("renders every section with an accessible name", () => {
    render(<SidebarNav />);
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    for (const item of navItems) {
      expect(
        within(nav).getByRole(item.id === "create" ? "button" : "link", {
          name: item.label,
        }),
      ).toBeTruthy();
    }
  });

  it("marks only the current section with aria-current", () => {
    navigation.pathname = "/direct/42";
    render(<SidebarNav />);
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["Сообщения"]);
  });
});

describe("creation chooser", () => {
  it.each([SidebarNav, MobileHeader])(
    "opens the same format choices from desktop and mobile",
    async (Shell) => {
      render(<Shell />);
      const user = userEvent.setup();
      const trigger = screen.getByRole("button", { name: "Создать" });
      expect(trigger.hasAttribute("data-auth-required")).toBe(true);
      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "Что создадим?" });
      for (const [name, href] of [
        ["Публикация", "/create"],
        ["Reels", "/create/reel"],
        ["История", "/stories/create"],
      ]) {
        expect(
          within(dialog).getByRole("link", { name }).getAttribute("href"),
        ).toBe(href);
      }
      await user.click(
        within(dialog).getByRole("button", { name: "Закрыть выбор формата" }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("closes on native Escape cancellation and backdrop, but not on dialog content", async () => {
    render(<MobileHeader />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Создать" });
    await user.click(trigger);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole("heading", { name: "Что создадим?" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("BottomNav", () => {
  it("shows the five mobile sections", () => {
    render(<BottomNav />);
    const names = screen.getAllByRole("link").map((link) => link.textContent);
    expect(names).toEqual([
      "Главная",
      "Reels",
      "Сообщения",
      "Поисковый запрос",
      "Профиль",
    ]);
  });
});
