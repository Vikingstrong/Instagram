import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BottomNav } from "./bottom-nav";
import { isNavItemActive, navItems } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

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
        within(nav).getByRole("link", { name: item.label }),
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

describe("BottomNav", () => {
  it("shows the five mobile sections", () => {
    render(<BottomNav />);
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "Главная",
      "Reels",
      "Сообщения",
      "Поисковый запрос",
      "Аккаунт",
    ]);
  });
});
