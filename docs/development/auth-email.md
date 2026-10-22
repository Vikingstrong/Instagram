# Auth — подтверждение email, восстановление и SMTP

Срез реализует оставшиеся операции [PRD FR-01](../product/PRD.md#fr-01--authentication--email-verification)
поверх существующих cookie-сессий. Тимлид временно является единственным
согласующим по своему указанию от 2026-10-22; продолжение реализации разрешено
после представления контракта. FND-08 и публичная SMTP-доставка этим не закрыты.

## Контракт и поведение

Все JSON mutations требуют разрешённого Origin, подписанного CSRF и его cookie,
возвращают `Cache-Control: no-store`. Zod-схемы и endpoint-константы находятся
в `packages/contracts`; OpenAPI и frontend используют их же.

| POST `/api/v1/auth/…` | Строгое тело | Успех |
| --- | --- | --- |
| `verification/request` | `{ email }` | 202 `{ status: "accepted" }` |
| `verification/confirm` | `{ token }` | 200 `{ status: "verified" }` |
| `password/request` | `{ email }` | 202 `{ status: "accepted" }` |
| `password/reset` | `{ token, password }` | 200 `{ status: "password_reset" }` |

Ответ запроса письма одинаков для неизвестного адреса, неподтверждённого,
подтверждённого и адреса с исчерпанной устойчивой квотой. Не возвращаются
существование аккаунта, состояние SMTP, адресат, user или token. Лимиты
HTTP-запросов дают 429 с Retry-After одинаково для известных и неизвестных
адресов. Это не обещание постоянного времени ответа или защиты регистрации
от enumeration; публичный допуск остаётся отдельной приёмкой.

- Регистрация атомарно создаёт аккаунт, verification token и задание письма;
  SMTP не вызывается внутри HTTP-транзакции. Сбой enqueue откатывает регистрацию.
  Автовхода нет. SMTP-сбой после commit не требует повторной регистрации.
- Токен: 32 случайных байта CSPRNG, base64url длиной 43; в `auth_tokens` только
  SHA-256. Verification — 24 часа, password reset — 30 минут. Purpose и
  credentialVersion проверяются при погашении. Invalid/expired/revoked/consumed/
  wrong-purpose получают один 400 `INVALID_OR_EXPIRED_TOKEN`.
- Выдача нового токена отзывает предыдущие непогашенные токены того же purpose
  и отменяет их ещё не отправленные задания. Квота выдачи на аккаунт общая для
  обоих видов писем: не чаще раза в минуту, максимум 3 в час, включая регистрацию.
  Она проверяется под user row lock по записям БД и переживает restart. При её
  исчерпании запрос остаётся generic accepted, новое письмо не создаётся.
- Дополнительно общий recipient HTTP limiter ограничивает все адреса теми же
  1/мин и 3/час; неизвестные адреса также расходуют bucket. Общие IP/mutation
  ограничения сессионного среза сохраняются.
- Погашение токена и login/reset используют один user row lock. Verification
  атомарно подтверждает email; существующая сессия видит свежий verified-флаг.
  Reset атомарно меняет hash, увеличивает credentialVersion, отзывает все
  сессии и все непогашенные токены аккаунта, отменяет pending mail. Нужен новый
  вход; новая сессия не выдаётся. Cookie другого аккаунта при reset не удаляется.

## MailModule и миграция

Новая additive migration `20261022110000_auth_mail_outbox` создаёт
`mail_deliveries`, её ограничения, индекс и cascade FK к auth token. Старый SQL
не переписывается. Auth владеет транзакцией; mail-owned записи меняются только
методами MailService. Redis, брокер и отдельный worker-процесс не добавлены.

Payload со ссылкой шифруется AES-256-GCM: случайный nonce, authentication tag,
AAD с tokenId для защиты от перестановки между адресатами. Отдельный server-only
ключ обязателен для реальной выдачи писем. После success/cancellation payload
удаляется; сырой token не сохраняется в открытом виде ни в токенах, ни в очереди.

Обработчик внутри API раз в секунду забирает одно задание через SQL
`FOR UPDATE SKIP LOCKED`, claim UUID и 90-секундную lease. В один момент в
процессе выполняется одна отправка. Завершение проверяет claim, чтобы старый
обработчик не перезаписал новую попытку. После падения lease истекает, попытка
повторяется. SMTP/DB exceptions и тело письма не логируются. Retry backoff —
30 секунд с удвоением до часа; истёкшие/отозванные/погашенные токены отменяются.

Доставка **at least once**: при потере подтверждения SMTP письмо может прийти
повторно. Message-ID стабилен между попытками, но это не гарантия deduplication
принимающей почты. Токен всё равно одноразовый. Квоты ограничивают выдачу новых
писем, а не гарантируют число физических доставок после неоднозначного SMTP-сбоя.
При смене credentials уже отправленное или находящееся в SMTP письмо нельзя
отозвать; ссылка в нём перестаёт работать.

SMTP-адаптер использует Nodemailer `10.1.7`, существующий release-age контроль
не ослаблен. Отключены SMTP debug/logger и file/URL attachment access. Production
требует TLS: implicit TLS либо обязательный STARTTLS с обычной проверкой
сертификатов. Локальный Mailpit использует loopback без SMTP credentials.
См. [официальную конфигурацию Nodemailer](https://nodemailer.com/smtp).

## Конфигурация и запуск

Добавьте в приватный root `.env`:

```dotenv
MAIL_OUTBOX_KEY=REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=noreply@example.test
SMTP_SECURE=false
```

Ключ должен содержать 32 случайных байта, оставаться стабильным между restart
и храниться отдельно от БД. Его потеря/неверная смена делает pending payload
нерасшифровываемым; задания не выдадут чужие/непроверенные ссылки. В dev отсутствие
ключа не блокирует readiness/login, но регистрация и реальная постановка письма
вернут безопасный 503 и откатятся. Production без ключа не запускается.
Только test-fixture mode допускает случайный ключ процесса и по умолчанию не
запускает автоматический mail worker. Для теста restart используется явный ключ.

Для production дополнительно задайте `SMTP_HOST`, действительный `SMTP_FROM`,
`SMTP_PORT`, при необходимости `SMTP_USER`/`SMTP_PASSWORD`, HTTPS
`AUTH_PUBLIC_ORIGIN` и прежний `AUTH_CSRF_SECRET`. Значения не публикуются.
`MAIL_WORKER_ENABLED=false` предназначен для явного отключения обработчика;
не выдавайте при этом очередь за доставленное письмо.

Примените миграции отдельно к dev/test и запустите PostgreSQL/Mailpit по
[локальной инструкции](local-environment.md). `test:integration` теперь требует
также настоящий Mailpit SMTP и UI API; UI-порт задаётся `MAILPIT_UI_PORT`
(default 8025), SMTP — `SMTP_PORT` (default 1025). Отсутствующий Mailpit — FAIL.

## Frontend и browser harness

Добавлены `/auth/request-verification`, `/auth/verify`, `/auth/forgot-password`,
`/auth/reset-password`, `/auth/password-changed`. Регистрация сообщает о постановке
письма в очередь, а не об успешной доставке. Для unverified-сессии доступен resend.

Письмо содержит fragment `#token=…`: bearer не попадает в HTTP URL, access log
или Referer. Форма считывает его один раз в память и очищает fragment/history;
StrictMode effect replay не теряет токен. После reload нужно заново открыть
ссылку из письма. GET не меняет состояние: verification требует нажатия кнопки,
reset — отправки нового пароля. Auth pages используют no-referrer/noindex.
После reset выполняется document navigation с сообщением о завершении сессий.

Для browser email-теста API должен обслуживать **изолированную TEST-базу**:

```bash
node --env-file=.env scripts/ci/start-test-api.mjs
# В другом терминале, при работающем Mailpit:
pnpm test:e2e
```

Launcher валидирует отдельные dev/test URL и меняет DATABASE_URL только в своём
API-процессе. До browser-регистрации тест логинится в уникальную TEST-фикстуру
через настоящий web rewrite: неверный/shared dev API приводит к FAIL до создания
browser-аккаунта. Cleanup удаляет только собственные UUID/email; mailbox глобально
не очищается. CI запускает Mailpit и этот launcher. Тест desktop/mobile использует
два независимых context, настоящие письма и реальный минутный cooldown.

## Проверки — 2026-10-22

Проверена рабочая копия изменений поверх `034bc98`, не новый опубликованный
commit. Прогоны выполнялись в отдельном checkout с копией итоговых исходников:
native PostgreSQL 18.6 на 55442, отдельные dev/test роли, Mailpit 11042/18042,
API 4100 против TEST-базы, web 3100. Временные ключи не печатались.
В копии Playwright изменены только web-порт/команда dev и адрес успешного
Swagger readiness; рабочие процессы пользователя на 3000/4000 не останавливались.

| Проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS в изолированном checkout; release-age политика без исключений |
| `pnpm build` | PASS, штатный Turbopack, API/contracts и все Auth pages |
| `pnpm check-types`, `pnpm lint` | PASS; API/contracts 0 warnings/errors |
| `pnpm test` | PASS: 14 contracts, 18 API unit, 43 web = 75 |
| Prisma validate, migration deploy dev/test | PASS; новый SQL применён к отдельным временным БД, повторный deploy без pending migrations |
| `pnpm --filter @instagram/api test:integration` | PASS, 44 PostgreSQL/SMTP tests |
| API/browser `pnpm test:e2e --env-mode=loose` | PASS: 4 API, 16 browser; 2 ожидаемых viewport skips |
| Настоящий SMTP → Mailpit | PASS, link из доставленного письма погашен через HTTP |
| Browser desktop/mobile, два пользователя | PASS: register/login, verification, resend, old-link rejection, recovery, one-time reset, новый вход и независимость второго аккаунта |

Интеграционные negative tests покрывают неверный purpose/expiry/replay, CSRF/
Origin/input, generic acceptance и квоты, rollback регистрации при enqueue
failure/отсутствующем ключе, конкурентное погашение/reset, гонку reset/login,
отзыв всех сессий, сохранение cookie другого аккаунта, SMTP failure/retry после
пересоздания worker, lease recovery, отмену отозванных заданий, перестановку
зашифрованных payload между адресатами и очистку payload после отправки.

Первый общий E2E выявил устаревший ожидаемый список OpenAPI routes; список
обновлён с сохранением остальных проверок. Затем browser-flow выявил сохранение
старого token при открытии новой fragment-ссылки на той же странице: обработчик
hashchange обновляет token и очищает прежний результат; устаревший ответ mutation
игнорируется, если пользователь уже открыл другой token. Добавлен unit regression,
повторный полный desktop/mobile прогон успешен. StrictMode replay также покрыт.

Контракт расширен четырьмя endpoints и новым error code. Новый discriminant
затрагивает exhaustive consumers; web message mapping обновлён вместе с API,
контрактами, Swagger и тестами. Wire-форма регистрации/сессий не изменена, но
регистрация теперь требует пригодный outbox key и применённую новую миграцию.

Рабочий root `.env` и существующая dev-БД не менялись. Перед использованием
среза в своём окружении нужно задать persistent MAIL_OUTBOX_KEY/SMTP и применить
обе versioned migrations. GitHub Actions для этих неопубликованных изменений
не запускался; обновление workflow не является доказательством cloud PASS.
Публичный SMTP-провайдер/доставка, review тимлида и FND-08 остаются отдельной
приёмкой. Docker установлен и Compose config прошёл; доступ к Docker socket
требует sudo в терминале владельца, поэтому запуск его тестового Compose-проекта
в текущем прогоне не подтверждён. Это не выдано за PASS.
