# Этап 2 — регистрация и cookie-сессии

Этот срез реализует backend регистрации, входа, чтения сессии и выхода.
FND-08 остаётся открытым; владелец разрешил реализацию до проверок двух ПК.
**Дополнение:** [Auth email](auth-email.md) реализует verification/recovery,
отправку писем и соответствующие формы; [Auth web](auth-web.md) — вход/регистрацию.
Новый аккаунт неподтверждённый; вход не даёт ему права на основные функции.

## Работающие endpoints и Swagger

После настройки БД и применения [миграции](auth-database.md) запустите API.
Swagger UI: **http://localhost:4000/api/docs/**, раздел **Auth**.
OpenAPI JSON: `http://localhost:4000/api/docs/openapi.json`.

| Метод / путь | Успех | Поведение |
| --- | --- | --- |
| `GET /api/v1/auth/csrf` | 200 | Возвращает подписанный CSRF-токен и при необходимости устанавливает HttpOnly-cookie |
| `POST /api/v1/auth/register` | 201 | Создаёт неподтверждённый аккаунт и атомарно ставит письмо подтверждения в очередь; автовхода нет |
| `POST /api/v1/auth/login` | 200 | Проверяет email/пароль, устанавливает новую непрозрачную cookie-сессию |
| `GET /api/v1/auth/session` | 200 | Возвращает публичного пользователя либо `user: null` |
| `POST /api/v1/auth/logout` | 200 | Отзывает текущую сессию, очищает cookie, возвращает `status: signed_out`; повторный вызов допустим |

Публичный пользователь содержит только `id`, `email`, `username`, `emailVerified`.
Пароль, хеши, credentialVersion и session token не возвращаются в JSON.
Все Auth-ответы и ошибки имеют `Cache-Control: no-store`.

### Проверка через Swagger UI

1. Раскройте `registerAuth`, нажмите Try it out, укажите уникальные email/username
   и пароль 12–128 Unicode code points. Execute должен вернуть 201 и
   `emailVerified: false`. Примеры в Swagger синтетические, не реальные credentials.
2. Выполните `loginAuth` с теми же email/паролем. Ответ 200 содержит пользователя;
   браузер сохраняет HttpOnly-cookie. Вручную вводить bearer token не нужно.
3. Выполните `getAuthSession`: должен вернуться тот же пользователь.
4. Выполните `logoutAuth` с пустым JSON-объектом `{}`, затем повторите
   `getAuthSession`: теперь `user: null`.

Swagger автоматически получает CSRF для своих POST-запросов **только на тот же
origin**, добавляет `X-CSRF-Token` и использует browser cookie jar. Он не
отключает серверную проверку. Браузер самостоятельно задаёт Origin.
Используйте `localhost:4000`, не `127.0.0.1:4000`: последний не входит в доверенные
dev-origin по умолчанию. Readiness GET не требует Origin и работает отдельно.

Подтвердить аккаунт можно ссылкой из настоящего письма Mailpit; см.
[email-срез](auth-email.md). Ручное изменение БД не заменяет этот сценарий.

## Контракт и web

Zod-схемы запросов, ответов, ошибок и endpoint-константы находятся в
`@instagram/contracts`. API валидирует input и явно формирует DTO; OpenAPI
строится из этих же схем. Неизвестные поля (например, `role` или `emailVerified`
в регистрации) отклоняются. При конфликте email/username — общий 409
`ACCOUNT_UNAVAILABLE`, без указания конкретного занятого поля. Это не обещание
полной защиты регистрации от enumeration; публичный допуск принимается отдельно.

Формы регистрации/входа и состояние сессии добавлены в [web-срезе](auth-web.md).
Browser-формы используют общий API-клиент:
сначала GET csrf, затем JSON mutation с `csrfToken` в RequestOptions.
Browser-запросы идут через относительный `/api/v1/*` и Next rewrite.
Cookies устанавливаются браузером из API-ответов; хранить их в localStorage нельзя.
Клиент распознаёт новые ошибки и локализует их по code, не выводит raw message
или requestId и запрещает redirect запросов с credentials/body.

Server Components могут читать сессию через request-scoped серверный клиент,
который пересылает Cookie. Прямой server-side login не переносит Set-Cookie
автоматически в ответ браузеру: текущий frontend-клиент не объявляется готовым
механизмом Server Action authentication. Web-срез использует browser mutations
и document navigation при смене аккаунта, без независимой Next.js auth-системы.

Foundation сохраняет свой точный readiness 503-контракт. Auth использует
`AuthApiErrorResponseSchema`; web transport принимает объединение этих схем.
Ошибки включают безопасный фиксированный message и случайный UUID requestId.
Malformed JSON и body более штатных 100 KiB возвращают безопасные 400/413;
исходный input и driver error не сериализуются. Остальные legacy routes не
переведены автоматически на глобальный Auth-контракт ошибок. Типизированные
AuthError (например, отказ verified guard) сохраняют безопасный Auth envelope
и вне Auth-prefix; остальные legacy exceptions сохраняют прежнее поведение.
Auth-prefix также исключён из Observe HTTP tracing, чтобы credentials/cookies
и внутренние error snapshots не попадали в APM. Это не разрешение логировать
пароли или токены в прикладном коде.

## Пароли и сессии

- Node.js `crypto.scrypt`: N=32768, r=8, p=3, соль 16 случайных байт, ключ 64 байта,
  maxmem 64 MiB. Формат `scrypt-v1` версионирован. Это стандартный scrypt,
  без новой зависимости и без собственной криптографической функции.
- Пароль не обрезается/нормализуется; Unicode не ограничивается UTF-16 units.
  Сравнение результата — timingSafeEqual. Для неизвестного email и неподдержанного
  hash выполняется тот же профиль scrypt с dummy hash, затем общий 401.
- Не более четырёх outstanding scrypt-операций в процессе; при насыщении — 503,
  без неограниченной очереди. Параметры требуют измерения на целевом сервере
  до публичного запуска. Не ослаблять их ради прохождения тестов.
- Сессия: 32 случайных байта CSPRNG, base64url в cookie, SHA-256 hex в PostgreSQL,
  срок 7 суток. Cookie: HttpOnly, SameSite=Lax, Path=/, host-only. Production:
  Secure и имя `__Host-instagram-session`; dev: `instagram-session`.
- После hash-check login блокирует строку пользователя и повторно проверяет
  hash/version перед созданием сессии. Конкурентная смена credentials приводит
  к 401, а не выдаче сессии со старым паролем. Reset блокирует ту же строку;
  см. [email-срез](auth-email.md) и [DB-правила](auth-database.md).
- Каждый session lookup проверяет expiry, revokedAt и совпадение версии с
  пользователем. Logout отзывает конкретную сессию, другие устройства остаются
  активными. Reset отзывает все сессии аккаунта атомарно со сменой пароля.

`VerifiedSessionGuard` экспортирован для будущих предметных API: анонимный запрос
получает 401, неподтверждённый пользователь — 403. Новые защищённые endpoints
должны реально применять этот guard/эквивалентную серверную политику, а не только
скрывать UI. В production не добавлен искусственный protected probe endpoint;
он существует лишь в HTTP integration-фикстуре.

## CSRF, Origin, лимиты и конфигурация

JSON mutations требуют cookie и идентичный `X-CSRF-Token`. CSRF содержит случайный
nonce, timestamp и HMAC-SHA256; срок 1 час. Cookie HttpOnly/SameSite=Lax/host-only,
в production `__Host-instagram-csrf`, Secure, Path=/. Подпись проверяется на сервере;
подставить одинаковый неподписанный токен в cookie/header недостаточно.

`AUTH_PUBLIC_ORIGIN` — server-only origin приложения, без пути/credentials/query.
Dev default — `http://localhost:3000`; только для этого default также разрешён
`http://localhost:4000` для локального Swagger. Отсутствующий/чужой Origin отклоняется
на mutations. CORS wildcard, доверие к произвольному Host/X-Forwarded-For не добавлены.

В production **обязательны** `NODE_ENV=production`, HTTPS `AUTH_PUBLIC_ORIGIN`
и `AUTH_CSRF_SECRET`: 32 случайных байта в lowercase hex, созданные безопасным
генератором и сохранённые как server secret. Не публикуйте значение, не передавайте
через NEXT_PUBLIC. В dev без секрета используется случайный ключ процесса;
после рестарта нужно заново получить CSRF. Сессии остаются в БД и не зависят от
CSRF signing key. В production Swagger должен обслуживаться на согласованном
HTTPS origin; локальный origin 4000 автоматически не разрешается.

`pnpm --filter @instagram/api start:prod` использует переносимый Node launcher,
который принудительно выставляет production до загрузки модулей. Без нужных
Auth-настроек запуск завершается ошибкой; команда не откатывается к dev-cookie.
При прямом `node dist/main.js` NODE_ENV=production нужно передать самостоятельно.

| Ограничение одного процесса | Значение |
| --- | --- |
| GET csrf/session по socket IP | 300 / 5 минут |
| JSON mutations по socket IP | 60 / 5 минут |
| Регистрация по нормализованному email | 3 / 15 минут |
| Вход по нормализованному email | 5 / 15 минут |
| Записей rate-limit store | 10 000; при насыщении fail closed |

Превышение возвращает 429 и Retry-After; raw email не хранится в ключе limiter.
Ограничения in-memory соответствуют одному API; рестарт сбрасывает окна.
За Next proxy пользователи пока делят socket-IP bucket. Это консервативное
ограничение, а не готовая публичная схема trusted ingress. До открытого запуска
нужно проверить реальный proxy, квоты и защиту от злоупотреблений; не доверять
заголовку X-Forwarded-For без отдельной конфигурации и тестов.

## Что ещё осталось в этапе 2

- Verification/recovery/resend, одноразовые ссылки, атомарный reset, очередь
  и SMTP, а также формы и реальный Mailpit browser-flow добавлены в
  [Auth email](auth-email.md). Проверки и конфигурация описаны там.
- Нужны review тимлида и окончательная приёмка локального Auth/email-сценария.
  Автовход после reset остаётся отдельным будущим пожеланием владельца.
- SMTP-провайдер размещённой демоверсии и реальная публичная доставка пока
  не выбраны/не подтверждены; локальный Mailpit этого не заменяет.
- Финальная приёмка FND-08 на двух реальных ПК и этапа 2. Успешный CI этого
  среза не означает завершение Auth/email или готовность публичного запуска.

## Результаты проверки — 2026-10-22

Исторический отчёт сессионного среза. Результаты следующего email-среза
приведены в [Auth email](auth-email.md).

Локально использован новый изолированный Compose-проект PostgreSQL 18.6 со
своими dev/test credentials, портом и volume. Корневой `.env` и существующая
dev-БД не менялись. Browser Auth-fixture запускает отдельный compiled API с
test-ролью/БД на свободном порту, удаляет только свои уникальные записи и
останавливает свой процесс. Полный smoke использует отдельный compiled API.

| Проверка | Результат |
| --- | --- |
| Build/types/lint | PASS, штатный Turbopack; 0 предупреждений линтера |
| Unit/contracts | PASS: 12 contracts + 16 API + 32 web = 60 |
| PostgreSQL integration | PASS: 30, включая 14 Auth HTTP и ранее добавленные 16 DB/readiness |
| Корневой API/browser e2e | PASS: 4 API, 14 browser; 2 browser skips по viewport |
| Swagger Execute register/login/session/logout | PASS на desktop/mobile, реальная test-БД и browser cookie jar |
| Production launcher | PASS: отсутствующий secret блокирует запуск даже при унаследованном NODE_ENV=development; с корректными настройками реальный процесс выдаёт Secure/__Host cookie и правильную OpenAPI-схему |
| Ссылки docs, `git diff --check` | PASS |
| Реальные ПК обоих разработчиков, FND-08 | Не подтверждены |

Полный локальный e2e запускался с `--env-mode=loose`, чтобы передать
process-env URL временных БД вместо изменения root `.env`.
Это настройка локального прогона, не изменение CI: CI использует штатный
`pnpm test:e2e` с одноразовым собственным `.env`.

| Исправленное отклонение при проверке | Повторная проверка |
| --- | --- |
| Слишком большой JSON сначала возвращал безопасный 500 вместо 413 | Исправлен Auth filter; malformed/oversized input дают безопасные 400/413 |
| Первый full e2e helper передал PORT=4000 одновременно API и Next | Разделено окружение процессов; корневой e2e успешно повторён |

Успешные проверки сессионного среза не засчитываются как verification/recovery,
отправка писем, UI-формы или финальная приёмка этапа 2. Результат полного
GitHub CI для последнего commit фиксируется в описании PR.
