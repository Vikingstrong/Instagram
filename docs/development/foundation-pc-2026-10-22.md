# Foundation — ПК Developer 1, 2026-10-22

Перечисленные проверки прошли на локальном ПК. **FND-08 остаётся открытым**:
нужны подтверждение Compose, отчёт второго ПК и совместная приёмка.
Владелец сообщил, что предоставит результаты второго разработчика и SHA.

## Окружение

- Fedora Linux 44 Workstation, Linux `7.2.8-200.fc44.x86_64`.
- Node `24.19.0`, pnpm `12.14.0`, PostgreSQL `18.6`, Prisma `7.10.1`.
- SHA: `034bc981c4c934abec0defb565d7d770160d312a`.
- Отдельный чистый локальный clone без hard links, установка с нуля по lockfile.
- Новый native-кластер на `127.0.0.1:55442`; репозиторный init-скрипт создал
  отдельные dev/test базы и роли. Новый временный `.env`, случайные пароли,
  режим `0600`; существующая БД пользователя не использовалась.
- Отдельный Podman-контейнер Mailpit `v1.31.5`, loopback SMTP `11042`, UI `18042`.
- Chromium Playwright `1248`, канал `chromium`, временный каталог. Playwright
  использовал Ubuntu 24.04 fallback для Fedora; фактический запуск прошёл.
  Системные пакеты и зависимости проекта не добавлялись.

Порты `3000/4000` заняты процессами пользователя. Использованы web `3100`, API
`4100`, `API_INTERNAL_ORIGIN=http://127.0.0.1:4100`. Только во временном checkout
изменены порт и команда webServer в `apps/web/playwright.config.ts`, адрес
успешного Swagger smoke в `apps/web/e2e/swagger.spec.mts`. Утверждения тестов
не менялись. До этих изменений build/types/lint/unit/integration выполнялись
с неизменёнными отслеживаемыми исходниками.

## Результаты

Turbo cache принудительно отключён для build/types/lint/unit; E2E также прошёл
без попаданий в кеш. Результаты относятся к указанному SHA и окружению.

| Команда / проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS, 946 пакетов, lockfile не изменён |
| `pnpm build` | PASS, штатный Turbopack, API и contracts |
| `pnpm check-types` / `pnpm lint` | PASS |
| `pnpm test` | PASS: 12 contract, 16 API unit, 32 web unit |
| `pnpm --filter @instagram/api db:validate` | PASS |
| `pnpm --filter @instagram/api db:migrate:deploy` | PASS, Auth-миграция в новой dev-БД |
| `pnpm --filter @instagram/api db:migrate:test` | PASS, миграция в отдельной test-БД |
| `pnpm --filter @instagram/api db:check` и `db:check --test` | PASS, compiled ESM client и настоящий SQL на обеих БД |
| `pnpm --filter @instagram/api test:integration` | PASS, 30 PostgreSQL-тестов |
| `pnpm test:e2e --env-mode=loose` | PASS: 4 API, 14 browser; 2 viewport skips |
| Swagger UI / OpenAPI | PASS; браузерный Execute проверяет readiness 200/503 |
| Остановка / восстановление отдельной БД | PASS: readiness 200 → 503 → 200, без перезапуска API |
| Readiness при отказе БД | PASS: shared Zod contract, `Cache-Control: no-store`, нет URL/паролей/CSRF secret |
| SMTP → Mailpit | PASS, синтетическое письмо найдено в mailbox API и настоящем браузерном UI |
| `pnpm dev:api`, `pnpm dev:web --port 3100` | PASS; браузер → web → API → PostgreSQL возвращает 200 |

E2E получил `API_INTERNAL_ORIGIN`, `PLAYWRIGHT_BROWSERS_PATH` и
`PLAYWRIGHT_CHANNEL=chromium`; `--env-mode=loose` передаёт их процессам Turbo.
Два skips — desktop rail на mobile и mobile tabs на desktop. Readiness, шрифты,
Swagger 200/503 и Auth Swagger smoke выполнены в обоих viewport. Это не проверка
ещё не реализованных verification/recovery/email UI.

Первый вызов `start:prod` с локальным HTTP `AUTH_PUBLIC_ORIGIN` завершился
ошибкой конфигурации: production требует HTTPS. Защита не изменялась;
compiled API smoke затем запущен через
`node --env-file=.env apps/api/dist/main.js` с development-конфигурацией,
после него отдельно проверены dev-команды. Production deployment не проверен.

## Остаток приёмки

- Docker CLI и Compose provider отсутствуют, в том числе provider Podman.
  `docker compose config --quiet` и точный Compose startup не выполнены.
  Native PostgreSQL и отдельный Mailpit не заменяют это подтверждение.
- Корневой одновременный `pnpm dev` на стандартных портах не запускался из-за
  занятых `3000/4000`; проверены обе штатные dev-команды на свободных портах.
- Нужны отчёт второго ПК, сопоставление SHA и совместное review по
  [FND-08](foundation-acceptance.md).
- GitHub Actions этого SHA в рамках локальной проверки не запускался и не
  проверялся; исторический Foundation run не выдан за новый PASS.

По завершении остановлены только созданные для проверки процессы и контейнер.
Временные данные PostgreSQL сохранены; reset, truncate и удаление volumes не
выполнялись. Локальные логи и browser-артефакты сохранены в
`/tmp/instagram-foundation-results-034bc98/`, в Git не включены.

## Дополнение: установка Docker на этом ПК

Позже 2026-10-22 по поручению владельца подготовлен установочный скрипт по
[официальной инструкции Docker для Fedora](https://docs.docker.com/engine/install/fedora/).
Владелец запустил его в своём терминале с sudo. Проверено после установки:
Docker Engine CLI `29.9.2`, Compose `5.6.1`, служба `docker` — active.
`docker compose config --quiet` для отдельного проекта с новым временным env
завершился успешно. Исходный раздел выше описывает окружение до этой установки.

Startup/healthcheck/named volume ещё не подтверждены: у процесса агента нет
доступа к `/var/run/docker.sock`, sudo требует пароль в терминале владельца.
Подготовлен `/tmp/instagram-check-compose.sh` для запуска владельцем через sudo:
он создаёт отдельный Compose-проект на свободных портах, ожидает проверки и
останавливает только его сервисы с сохранением volume. Готовность проекта пока
не получена; это ограничение нельзя засчитать как PASS. Права аккаунта и
доступ к Docker socket для обхода ограничения не менялись.
