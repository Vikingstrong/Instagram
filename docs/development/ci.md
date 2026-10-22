# FND-07 — Foundation CI

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
Запускается для pull request, push в `main` и вручную через `workflow_dispatch`.
Один job `Workspace, PostgreSQL and browser checks` выполняется на Ubuntu 24.04.
Node берётся из `.nvmrc`, Corepack выбирает pnpm из корневого `packageManager`;
установка использует `--frozen-lockfile`. Actions закреплены commit SHA,
токен имеет только `contents: read`, checkout не сохраняет Git credentials.

## Что проверяется

1. `scripts/ci/prepare-env.mjs` создаёт новый приватный `.env` со случайными
   локальными паролями и отдельными dev/test ролями и базами. Существующий файл
   не перезаписывается; значения не печатаются. GitHub Secrets для этого не нужны.
2. `docker compose up -d --wait --wait-timeout 90 postgres` запускает закреплённый
   PostgreSQL 18.6. Init-скрипт создаёт изолированные БД и права, healthcheck
   ожидает готовность сервера. Затем проверяется Prisma schema.
3. `pnpm build`, `pnpm check-types`, `pnpm lint`, `pnpm test` выполняют явные
   задачи API, web и contracts. Шаги последовательны: несколько API-команд
   генерируют Prisma Client в один каталог. Turbo cache между запусками CI
   не сохраняется; сборка и проверки выполняются в свежем checkout.
4. `db:migrate:deploy` и `db:migrate:test` применяют существующую историю к
   отдельным CI-базам. Сейчас миграций нет. `test:integration` проверяет настоящую
   PostgreSQL, изоляцию ролей, HTTP readiness 200 и безопасный 503 при отказе БД.
5. CI устанавливает Chromium Playwright и его системные зависимости. Запускается
   скомпилированный API; `scripts/ci/check-api.mjs` ожидает контрактный readiness
   с реальным SQL-запросом, проверяет `Cache-Control: no-store`, Swagger UI и
   OpenAPI JSON. После этого API остаётся запущенным на время `pnpm test:e2e`.
6. Корневой E2E запускает API Vitest/Supertest и web Playwright. Playwright при
   `CI=true` использует установленный Chromium, запускает Next dev сам и проверяет
   desktop/mobile shell. При ошибке сохраняются browser traces на 7 дней.

Ошибка любой команды делает job неуспешным; `continue-on-error`, подавления
кодов завершения тестов и разрешения пустых наборов тестов нет. Cleanup работает
даже при ошибке: останавливает API и удаляет контейнеры/volumes этого CI-runner.
Команда удаления volumes предназначена только для одноразовой CI-машины;
для локальных данных используйте инструкции [FND-03](local-environment.md).

## Границы готовности

Browser readiness реализован в `apps/web/e2e/readiness.spec.mts`: браузер
обращается к настоящему API/БД через web rewrite. [FND-05](web-api.md) описывает
proxy, внутренний адрес и серверный клиент. API readiness 200/503 с настоящей
БД проверяется также отдельно. Компонентные и браузерные проверки описаны в [FND-06](frontend-testing.md).
CI не реализует auth, отправку писем или продуктовые сценарии; совместная
приёмка Foundation остаётся FND-08.

В hover-тесте rail курсор явно отводится от панели, затем проверяется завершение
перехода в свёрнутое состояние. Это устраняет зависимость от начальной позиции
курсора Chromium; проверки сворачивания и раскрытия сохранены.

Workflow выполняет штатный `pnpm build` с Turbopack. Ранее в облачной среде Codex
загрузка Google Fonts завершалась ошибкой прокси. Теперь существующие Geist,
Geist Mono и Grand Hotel включены в репозиторий с OFL-лицензиями и загружаются
через `next/font/local`: build/dev не обращаются к Google Fonts. Источники и
контрольные суммы — в [font README](../../apps/web/app/fonts/README.md).
`apps/web/e2e/fonts.spec.ts` блокирует Google Fonts и проверяет загрузку всех
трёх гарнитур с origin приложения в desktop/mobile. CI не подменяет build
Webpack-сборкой; TLS/checksum verification не ослаблены.

Наличие workflow и успешные локальные команды не доказывают успешный запуск
GitHub Actions. Для новых изменений нужен реальный GitHub run и человеческое
review. Требование этого job перед merge настраивается отдельно в GitHub ruleset
или branch protection; workflow сам не включает защиту ветки.

## Локальная проверка реализации — 2026-10-21

Исторический отчёт FND-07 до включения browser readiness в FND-05. После
отправки FND-07 [первый GitHub run](https://github.com/Vikingstrong/Instagram/actions/runs/39653120288)
завершился успешно. Результаты новых web-проверок приведены в [FND-05](web-api.md).

| Проверка | Результат |
| --- | --- |
| actionlint 1.7.7, ссылки документации, `git diff --check` | PASS |
| Генерация CI `.env` в отдельном временном каталоге | PASS: разные пароли, режим 0600, повторный запуск отказывается перезаписывать файл |
| Frozen install, `pnpm check-types`, `pnpm lint` | PASS |
| `pnpm test` | PASS: 8 API, 4 contract, 14 web |
| Prisma validate, dev/test migration deploy | PASS; 0 прикладных миграций |
| `test:integration` | PASS: 6 тестов с PostgreSQL 18.6 |
| API build и `scripts/ci/check-api.mjs` | PASS: скомпилированный API, реальный readiness, Swagger UI/OpenAPI |
| `CI=true pnpm test:e2e` с Chromium Playwright 1248 | PASS: 4 API и 4 browser; 4 browser skips (2 по размеру экрана, 2 pending readiness) |
| Штатный `pnpm build` | FAIL: Turbopack не загрузил Google Fonts через прокси облачной машины |
| GitHub Actions на runner Ubuntu 24.04 | NOT RUN: ветка ещё не отправлена |

Локально использованы существующие изолированные dev/test БД и внешний Compose
override облачной среды для доступа контейнера к init-скрипту. CI создаёт новые
БД в свежем checkout; точный запуск этого workflow подтверждается на GitHub.

## Локальные шрифты — проверка 2026-10-22

Дополнение FND-01/FND-06 устраняет описанную выше зависимость от Google Fonts.
Лицензии и бинарные файлы взяты из закреплённого upstream commit, контрольные
суммы проверены. Бинарники не менялись; CSS-переменные, веса и `display: swap`
сохранены. Полные TTF занимают около 397 KiB вместо Google web-subsets.

| Проверка | Результат |
| --- | --- |
| Штатный `pnpm build` | PASS: Turbopack собрал web локально; API/contracts также успешны |
| `pnpm check-types`, `pnpm lint`, `pnpm test` | PASS: 9 contract, 8 API, 31 web тест |
| `playwright test e2e/fonts.spec.ts` на `next start` с Chromium | PASS: desktop/mobile; три гарнитуры реально загружаются с origin приложения при блокировке Google Fonts |
| Контрольные суммы файлов, пути ссылок, `git diff --check` | PASS |
| Реальные ПК обоих разработчиков | Не проверены; FND-08 остаётся открытым |

Первый browser-run обнаружил ошибку проверки: `document.fonts.load` пытался
загрузить также системный Arial fallback, отсутствующий в Linux. Тест исправлен
так, чтобы проверять каждую включённую гарнитуру отдельно; повторный запуск
обоих viewport прошёл. Проверка не подменяет загрузку шрифта проверкой CSS.
