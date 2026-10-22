# Foundation — ПК Developer 2, 2026-10-22

Проверка FND-08 на втором реальном ПК. **FND-08 остаётся открытым**: Compose
не проверен, совместное review ещё не проведено. Пока Developer 1 недоступен,
решения по исправлениям ниже приняты Developer 2 соло (временное правило
roadmap) и требуют review в PR.

## Окружение

- Windows 10 Pro 19045, Git Bash / PowerShell.
- **Node 24.13.1** — ниже `.nvmrc` 24.19.0 и `engines`; `pnpm install`
  прошёл без ошибки и предупреждения. Отклонение не устранялось.
- pnpm 12.14.0, PostgreSQL 18.6 (native), Google Chrome 155 для Playwright
  (`PLAYWRIGHT_CHANNEL` по умолчанию `chrome`).
- Docker отсутствует, поэтому Compose не проверялся.
- PostgreSQL: отдельный временный кластер на `127.0.0.1:55432`, SCRAM, базы и
  роли созданы `scripts/database/init.sh`. Системный PostgreSQL пользователя
  (5432) не использовался. TimeZone сервера — `America/Buenos_Aires` (UTC−3).
- Mailpit v1.31.5 native (`mailpit-windows-amd64.zip`, sha256 сверен с
  digest релиза в GitHub API), SMTP `127.0.0.1:1025`, UI `127.0.0.1:8025`.
- `.env` из `.env.example` со случайными паролями, вне Git.

## Результаты

Первый прогон — чистый clone `2bca154`; повтор — ветка `fix/foundation-acceptance`
от `6c731a2` с исправлениями ниже.

| Команда / проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, 947 пакетов, lockfile не изменён |
| `pnpm build` (Turbopack), `pnpm check-types`, `pnpm lint` | PASS |
| `pnpm test` | PASS: contracts 14, API 18, web 52 |
| `db:validate`, `db:migrate:deploy`, `db:migrate:test`, `db:check` (dev и `--test`) | PASS |
| `test:integration` на `2bca154` | **FAIL 34/44**: 9 Auth-email — баг §1, 1 SMTP — Mailpit ещё не был установлен |
| `test:integration` после исправлений | PASS 46/46, включая SMTP → Mailpit, TimeZone сервера не UTC |
| Readiness | 200 `{"status":"ready"}`, `Cache-Control: no-store` |
| Остановка / возврат БД | 503 `SERVICE_UNAVAILABLE`, безопасное тело, `no-store` → 200 без перезапуска API |
| Browser E2E | `--workers=1`: 17 passed, 2 viewport skips, 1 FAIL — desktop `auth-email` (вход после сброса пароля не уложился в 5 с, scrypt под нагрузкой); отдельный повтор этого теста PASS (1.8m) |

Не выполнено: Docker Compose; одновременный корневой `pnpm dev` (API и web
запускались по отдельности).

## Найдено и исправлено в этой ветке

1. **Часовой пояс БД.** `PrismaPg` не задавал TimeZone сессии; адаптер передаёт
   даты без смещения, поэтому при сервере не в UTC значения из JS расходились с
   `CURRENT_TIMESTAMP` на смещение пояса. Письма не забирались из очереди
   (`attempts: 0`), сдвигались lease и кулдауны. Исправление:
   `options: '-c TimeZone=UTC'` в `database.client.ts`. Регрессионный тест в
   `database.integration-spec.ts` падает без исправления
   (`Received: "America/Buenos_Aires"`) и проходит с ним.
2. **`.local/postgres` в Git.** Коммит `761ef34` добавил живой каталог данных
   PostgreSQL (1579 файлов, ~71 МБ, включая `pg_hba.conf`). `.local/` уже в
   `.gitignore`, но файлы оставались отслеживаемыми. Удалены из индекса
   (`git rm --cached`), на дисках остаются. **В истории Git они сохраняются**;
   чистка истории требует force-push и решения команды. Пароли ролей того
   кластера стоит считать раскрытыми и не использовать повторно.
3. **Гонка `prisma generate`.** `build`, `lint`, `check-types` API каждый
   запускали генерацию; параллельный `turbo run build lint check-types` падал
   с «exists and is not empty but doesn't look like a generated Prisma Client».
   Генерация вынесена в одну задачу Turbo `@instagram/api#db:generate`, от
   которой зависят build/lint/check-types/test API.
4. **Лента размонтировалась при каждом возврате во вкладку.** `HomeAccess` на
   focus/pageshow/visibility показывал полноэкранную загрузку; терялись
   прокрутка и локальное состояние. Теперь при перепроверке скрывается только
   identity (прежнее правило), лента остаётся смонтированной и пересоздаётся
   только при смене аккаунта. Новый component-тест.

Ранее в PR #17: E2E-хелпер `auth-api.mts` останавливает изолированный API
через IPC вместо SIGTERM (Windows не перехватывает SIGTERM).

## Наблюдения без исправления

- Под параллельной нагрузкой (`turbo run build check-types lint test`) unit-тесты
  `password-hasher.spec.ts` превышают 5 с; по отдельности `pnpm test` стабильно
  проходит. Browser E2E на этом ПК стабильны с `--workers=1`; в 2 потока вход
  (scrypt) и первая компиляция dev-страницы не укладываются в 5 с ожиданий.
- `experimental.agentFeedback` в `apps/web/next.config.ts` заставляет `next dev`
  создавать неотслеживаемый `apps/web/AGENTS.md`.
- `ObserveModule` в API подключён с плейсхолдер-ключами (внешняя телеметрия не
  согласована в архитектуре).
