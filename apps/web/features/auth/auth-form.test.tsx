import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

afterEach(() => vi.unstubAllGlobals());

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const account = { id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789", email: "person@example.test", username: "person", emailVerified: false };

async function fill(password = "a long password") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), account.email);
  const username = screen.queryByLabelText("Имя пользователя");
  if (username) await user.type(username, account.username);
  fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: password } });
  return user;
}

describe("AuthForm", () => {
  it("rejects invalid shared-contract input before any API request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<AuthForm mode="register" />);
    const user = await fill("short");
    await user.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(screen.getByRole("alert").textContent).toContain("Проверьте");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves Unicode code points and spaces, uses CSRF and never logs in after registration", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken }))
      .mockResolvedValueOnce(Response.json({ user: account }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<AuthForm mode="register" />);
    // 128 code points, 254 UTF-16 units: native maxlength must not truncate it.
    const password = ` ${"🔐".repeat(126)} `;
    const user = await fill(password);
    await user.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    await screen.findByRole("heading", { name: "Подтвердите email" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [path, init] = fetch.mock.calls[1];
    expect(path).toBe("/api/v1/auth/register");
    expect(JSON.parse(init.body)).toEqual({ email: account.email, username: account.username, password });
    expect(init.headers["X-CSRF-Token"]).toBe(csrfToken);
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(screen.getByRole("status").textContent).toContain("поставлено в очередь");
  });

  it("does not submit a mutation if CSRF fails", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    render(<AuthForm mode="login" />);
    const user = await fill();
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await screen.findByRole("alert");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Пароль") as HTMLInputElement).value).toBe("");
  });

  it("shows a safe login error and blocks duplicate submissions while pending", async () => {
    let respond!: (response: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", fetch);
    render(<AuthForm mode="login" />);
    const user = await fill();
    await user.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    expect(fetch).toHaveBeenCalledTimes(2);
    respond(Response.json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password.", requestId: account.id } }, { status: 401 }));
    expect((await screen.findByRole("alert")).textContent).toBe("Неверный email или пароль.");
    expect(screen.getByRole("button", { name: "Войти" }).hasAttribute("disabled")).toBe(false);
  });
});

it("accepts exactly eight password characters and lets the user reveal them", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ user: account }, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  render(<AuthForm mode="register" />);
  const user = await fill("12345678");
  await user.click(screen.getByRole("button", { name: "Показать пароль" }));
  expect(screen.getByLabelText("Пароль").getAttribute("type")).toBe("text");
  await user.click(screen.getByRole("button", { name: "Создать аккаунт" }));
  await screen.findByRole("heading", { name: "Подтвердите email" });
  expect(JSON.parse(fetch.mock.calls[1][1].body).password).toBe("12345678");
});
