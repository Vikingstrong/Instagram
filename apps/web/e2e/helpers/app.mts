import { expect, type Locator, type Page } from '@playwright/test';
import { AuthCsrfResponseSchema } from '@instagram/contracts';
import { crc32, deflateSync } from 'node:zlib';
import { startAuthApi } from './auth-api.mjs';

// Shared browser-test steps: unique verified TEST accounts, sign-in and a
// generated photo.
export type Fixture = Awaited<ReturnType<typeof startAuthApi>>;

export async function registeredAccount(): Promise<Fixture> {
  const fixture = await startAuthApi();
  const csrfResponse = await fetch(fixture.origin + '/api/v1/auth/csrf');
  const csrf = AuthCsrfResponseSchema.parse(await csrfResponse.json());
  const registration = await fetch(fixture.origin + '/api/v1/auth/register', {
    method: 'POST',
    headers: {
      Origin: fixture.origin,
      'Content-Type': 'application/json',
      Cookie: csrfResponse.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '),
      'X-CSRF-Token': csrf.csrfToken,
    },
    body: JSON.stringify(fixture.account),
  });
  expect(registration.status).toBe(201);
  return fixture;
}

export async function login(page: Page, account: Fixture['account']) {
  await page.goto('/auth/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Пароль', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

// A solid-colour 640×480 PNG, built by hand so the test needs no image library.
export function photo([r, g, b]: [number, number, number]) {
  const width = 640;
  const height = 480;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const frame = Buffer.alloc(body.length + 8);
    frame.writeUInt32BE(data.length, 0);
    body.copy(frame, 4);
    frame.writeUInt32BE(crc32(body), body.length + 4);
    return frame;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
}
