import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SuggestionsCarousel } from "./suggestions-carousel";

const users = [
  { username: "first.user", displayName: "First" },
  { username: "second.user", displayName: "Second" },
];

describe("SuggestionsCarousel", () => {
  it("removes a card when it is dismissed", async () => {
    render(<SuggestionsCarousel users={users} />);

    await userEvent.click(screen.getByRole("button", { name: "Скрыть first.user" }));

    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("hides the whole section after the last card is dismissed", async () => {
    render(<SuggestionsCarousel users={users.slice(0, 1)} />);

    await userEvent.click(screen.getByRole("button", { name: "Скрыть first.user" }));

    expect(screen.queryByText("Рекомендации для вас")).toBeNull();
  });
});
