import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailForm } from './email-form';
import { StrictMode } from 'react';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
const csrfToken = `${'a'.repeat(43)}.1792640000.${'b'.repeat(43)}`;
it('never consumes a verification token on page load and removes it from history', async () => {
  const token = 'c'.repeat(43);
  window.history.replaceState({}, '', `/auth/verify#token=${token}`);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken })).mockResolvedValueOnce(Response.json({ status: 'verified' }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<StrictMode><EmailForm mode="verify" /></StrictMode>); });
  expect(window.location.hash).toBe('');
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Подтвердить email' }));
  await screen.findByRole('status');
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/verification/confirm');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token });
});
it('uses a generic accepted message for recovery and requires an explicit new request', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken })).mockResolvedValueOnce(Response.json({ status: 'accepted' }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  render(<EmailForm mode="forgot-password" />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nobody@example.test' } });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Отправить письмо' }));
  expect((await screen.findByRole('status')).textContent).toContain('Если для этого адреса');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not submit a missing or malformed link token', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  window.history.replaceState({}, '', '/auth/reset-password#token=bad');
  await act(async () => { render(<EmailForm mode="reset-password" />); });
  expect(screen.getByRole('alert').textContent).toContain('нет действительного токена');
  expect(screen.getByRole('button', { name: 'Сохранить пароль' }).hasAttribute('disabled')).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('uses a newly opened fragment link on the same page after an old link failed', async () => {
  const first = 'c'.repeat(43); const second = 'd'.repeat(43);
  window.history.replaceState({}, '', `/auth/verify#token=${first}`);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired token.', requestId: '4f70d2ab-d6d6-4243-b0d3-f7b767434789' } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ status: 'verified' }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<EmailForm mode="verify" />); });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Подтвердить email' }));
  await screen.findByRole('alert');
  await act(async () => {
    window.history.pushState({}, '', `/auth/verify#token=${second}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
  await user.click(screen.getByRole('button', { name: 'Подтвердить email' }));
  await screen.findByRole('status');
  expect(JSON.parse(fetch.mock.calls[3][1].body).token === second).toBe(true);
});
