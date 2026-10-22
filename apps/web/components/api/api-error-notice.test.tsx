import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApiFailure } from "@/lib/api/client";
import { unavailableFixture } from "@/lib/api/contracts.fixture";
import { ApiErrorNotice } from "./api-error-notice";

const failures: { failure: ApiFailure; message: string }[] = [
  {
    failure: { kind: "api", status: 503, error: unavailableFixture.error },
    message: "Сервис временно недоступен. Попробуйте позже.",
  },
  {
    failure: { kind: "network" },
    message: "Нет соединения с сервером. Проверьте интернет.",
  },
  {
    failure: { kind: "invalid_response", status: 502 },
    message: "Что-то пошло не так. Попробуйте ещё раз.",
  },
  { failure: { kind: "aborted" }, message: "Запрос отменён." },
];

describe("ApiErrorNotice", () => {
  it.each(failures)("renders an accessible message for $failure.kind", ({ failure, message }) => {
    render(<ApiErrorNotice failure={failure} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(message)).toBeTruthy();
    expect(alert.textContent).not.toContain(unavailableFixture.error.requestId);
    expect(alert.textContent).not.toContain(unavailableFixture.error.message);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls the supplied retry action on keyboard activation", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ApiErrorNotice failure={{ kind: "network" }} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: "Попробовать снова" });

    expect(onRetry).not.toHaveBeenCalled();
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
