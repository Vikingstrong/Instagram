# Этап 2 — формы регистрации, входа и состояние сессии

Frontend использует существующие Auth-контракты и настоящий API. Новых схем,
зависимостей, миграций или Next.js authentication backend нет.
Требования: [PRD FR-01](../product/PRD.md#fr-01--authentication--email-verification),
[архитектура §8](../architecture/overview.md#8-authentication-and-session-architecture),
[Auth API](auth-api.md).

## Поведение

- `/auth/register`: username/email/password проверяются общими Zod-схемами.
  Unicode-пароль и пробелы сохраняются; HTML maxlength для пароля не используется,
  поскольку он считает UTF-16 units вместо согласованных code points.
- Успешная регистрация не выполняет автовход. После добавления email-среза
  UI сообщает о постановке письма в очередь и предлагает повторную отправку;
  это не обещание успешной доставки SMTP.
- `/auth/login`: вход через API cookie-сессию. Ошибки локализуются по code;
  raw message, requestId и внутренние данные не выводятся. Повторная отправка
  блокируется, пока запрос выполняется; mutations автоматически не повторяются.
- `/auth/session`: свежий GET с `no-store`, состояния loading/error/anonymous/
  user, требование подтверждения email для неподтверждённого аккаунта и выход.
  Ссылка «Аккаунт» в desktop/mobile навигации ведёт на эту страницу.
- Каждая mutation сначала получает новый CSRF через API. Пароли удаляются из
  поля после попытки отправки; cookies и токены не сохраняются в localStorage
  или sessionStorage. HttpOnly-cookie создаёт и отзывает только API.
- После входа/выхода выполняется полная document navigation, сбрасывающая
  предыдущий React/router state. Нет общего кеша пользователя. При focus,
  pageshow и возвращении вкладки сессия перечитывается; старое имя скрывается
  на время проверки. Устаревшие ответы отменённых запросов игнорируются.
  Выход очищает отображаемую identity до запроса; при ошибке не заявляется,
  что серверная сессия уже отозвана, и доступна повторная попытка.

Feed остаётся дизайном на фикстурах. Этот срез не определяет ещё открытые
правила гостевого просмотра и не заменяет серверную авторизацию предметных API.
Verification/recovery/resend, SMTP/durable retries и полный email browser-flow
добавлены в [следующем email-срезе](auth-email.md). По временному указанию
владельца review проводит тимлид один; этап 2 и FND-08 не объявляются закрытыми.

## Проверка первоначального web-среза — 2026-10-22

| Проверка | Результат |
| --- | --- |
| `pnpm build` | PASS, штатный Turbopack, три новых auth-маршрута |
| `pnpm check-types` / `pnpm lint` | PASS |
| `pnpm test` | PASS: 12 contracts, 16 API, 39 web; 7 новых тестов форм/сессии |
| `pnpm test:e2e --env-mode=loose` во временном checkout | PASS: 4 API, 14 browser; 2 ожидаемых viewport skips |
| Chromium desktop/mobile, настоящий web → API → PostgreSQL | PASS: регистрация, отсутствие автовхода, неверный пароль, Unicode-вход, HttpOnly-cookie и пустой browser storage |
| Два независимых browser context | PASS: logout отзывает старую cookie, второй аккаунт остаётся в системе; history navigation и смена аккаунта не показывают прежнего пользователя |
| Mobile layout | PASS, нет горизонтального overflow; просмотрен browser screenshot |

Browser-проверка выполнена временным acceptance-скриптом с реальными формами,
без mock или перехвата API. Использованы копия новых web-файлов в отдельном
checkout, web `3100`, API `4000`, native PostgreSQL `18.6` на `55442` из проверки
Foundation. Два синтетических аккаунта удалены по собственным уникальным email;
рабочий `.env` и данные пользователя не менялись. Скрипт и screenshots находятся
в `/tmp/instagram-auth-web-*`; это локальная проверка, не новый тест в CI.
Сначала browser-селектор ошибки захватил также Next route announcer; селектор
ограничен областью формы, повторный полный прогон прошёл.

Первые typecheck/component runs обнаружили недостаточное сужение union-типа
регистрации и неоднозначное accessible label из-за текста подсказок. Исправлены
типизация и отдельные label/help элементы; повторные проверки успешны.
