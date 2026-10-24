import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailForm } from './email-form';
import { StrictMode } from 'react';
import { replaceLocation } from '@/lib/navigation';

vi.mock('@/lib/navigation', () => ({ replaceLocation: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(replaceLocation).mockClear(); window.history.replaceState({}, '', '/'); });
const csrfToken = `${'a'.repeat(43)}.1792640000.${'b'.repeat(43)}`;
it('never consumes a recovery token on page load and removes it from history', async () => {
  const token = 'c'.repeat(43);
  window.history.replaceState({}, '', `/auth/reset-password#token=${token}`);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken })).mockResolvedValueOnce(Response.json({ status: 'password_reset' }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<StrictMode><EmailForm mode="reset-password" /></StrictMode>); });
  expect(window.location.hash).toBe('');
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.setup().type(screen.getByLabelText('Новый пароль'),'new password');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Сохранить пароль' }));
  // Confirmed: straight to the feed, no intermediate "check session" step.
  await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith('/auth/password-changed'));
  expect(screen.queryByRole('link', { name: 'Проверить сессию' })).toBeNull();
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/password/reset');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token, password:'new password' });
});
it('uses a generic accepted message for recovery and requires an explicit new request', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({passwordRecoveryEnabled:true})).mockResolvedValueOnce(Response.json({ csrfToken })).mockResolvedValueOnce(Response.json({ status: 'accepted' }, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  render(<EmailForm mode="forgot-password" />);
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'nobody@example.test' } });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Отправить письмо' }));
  expect((await screen.findByRole('status')).textContent).toContain('Если для этого адреса');
  expect(fetch).toHaveBeenCalledTimes(3);
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
  window.history.replaceState({}, '', `/auth/reset-password#token=${first}`);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired token.', requestId: '4f70d2ab-d6d6-4243-b0d3-f7b767434789' } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ status: 'password_reset' }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => { render(<EmailForm mode="reset-password" />); });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Новый пароль'),'new password');
  await user.click(screen.getByRole('button', { name: 'Сохранить пароль' }));
  await screen.findByRole('alert');
  await act(async () => {
    window.history.pushState({}, '', `/auth/reset-password#token=${second}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
  await user.type(screen.getByLabelText('Новый пароль'),'new password');
  await user.click(screen.getByRole('button', { name: 'Сохранить пароль' }));
  await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith('/auth/password-changed'));
  expect(JSON.parse(fetch.mock.calls[3][1].body).token === second).toBe(true);
});


it('shows recovery as unavailable without SMTP and never offers a misleading mail form',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({passwordRecoveryEnabled:false})));render(<EmailForm mode="forgot-password"/>);await screen.findByText(/пока не настроено/);expect(screen.queryByRole('button',{name:'Отправить письмо'})).toBeNull();});
