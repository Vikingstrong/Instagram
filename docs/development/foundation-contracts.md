# FND-02 — контракт технического среза

Основание: [roadmap FND-02](../roadmap.md#5-foundation-предлагаемые-github-issues),
[Architecture §12](../architecture/overview.md#12-shared-api-contracts).

Реализован минимальный пакет `@instagram/contracts`. Контракт
[принят Developer 2](fnd-02-review.md); runtime readiness и Swagger
реализованы в [FND-04](api-readiness.md). Wire format не изменён.

## HTTP-контракт

Реализованный endpoint: **GET `/api/v1/readiness`**, без body и query parameters.
Он не требует сессии, не раскрывает пользовательские данные и не определяет
правила гостевого доступа к профилям. Ответы должны иметь `Cache-Control: no-store`.

Успешный ответ **200**, схема `ReadinessResponseSchema`:

```json
{"status":"ready"}
```

Ответ **503**, схема `ApiErrorResponseSchema`:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Service is temporarily unavailable.",
    "requestId": "123e4567-e89b-42d3-a456-426614174000"
  }
}
```

- `requestId` — UUID v4, генерируемый сервером для корреляции с безопасными логами.
- `message` фиксирован: error.message драйвера не должен попадать в ответ.
  UI принимает решения по `code`; пользовательский текст может локализоваться.
- Схемы строгие: лишние поля, включая вложенные, отклоняются. Response projections
  API всё равно обязательны; схема не заменяет права доступа и очистку логов.
- Список кодов сейчас содержит только ошибку этого среза. Auth-коды, validation
  errors, пагинация и SSE добавляются в соответствующих согласованных задачах.
- Readiness **200** в FND-04 должен зависеть от реального успешного запроса к БД.
  Ошибка/таймаут зависимости даёт безопасный **503**, а не fixture-успех.

Маршрут и Swagger реализованы в [FND-04](api-readiness.md). Стартовый `GET /`
с `Hello World!` сохранён отдельно; он не проверяет БД.

## Пакет и команды

`packages/contracts/src/index.ts` экспортирует схемы, `readinessEndpoint` и типы,
выведенные через `z.infer`. Подпуть `@instagram/contracts/fixtures` экспортирует
JSON-совместимые примеры, валидируемые этими же схемами при импорте.

Runtime dependency — закреплённая Zod **4.6.7**, уже присутствовавшая в lockfile.
TypeScript 5.9.3 и Oxlint 1.88.0 переиспользуют существующие версии workspace.
Контрактные тесты используют встроенный `node:test`, без нового test runner.
Пакет собирается в ESM `dist/` с декларациями для NodeNext API и bundler web.
`dist/` исключён из Git. В runtime exports нет Prisma, NestJS, env или Node API.

Из корня:

```bash
pnpm install --frozen-lockfile
pnpm check-types
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

Turbo собирает workspace-зависимости перед зависимыми задачами. Для прямого
запуска команд из `apps/api`, `apps/web` или `packages/contracts` сначала
соберите пакет:

```bash
pnpm --filter @instagram/contracts build
pnpm --filter @instagram/contracts test
```

Корневые `pnpm dev`, `pnpm dev:web`, `pnpm dev:api` учитывают эту сборку.

## Передача frontend и текущая интеграция

1. Контракт [принят Developer 2](fnd-02-review.md). Изменения полей, статусов и
   ошибок согласуются с backend; независимые копии типов не создаются.
2. Web использует схемы из `@instagram/contracts`; REST-клиент и явный
   fixture-режим реализованы в `apps/web/lib/api/`. Fixtures проверяются теми же
   схемами и не подтверждают соединение с настоящей БД.
3. Backend readiness и Swagger реализованы в [FND-04](api-readiness.md).
   Схема origin и browser runner определены в [FND-01](foundation-baseline.md).
4. Web proxy и request-scoped серверный клиент реализованы в [FND-05](web-api.md).
   `apps/web/e2e/readiness.spec.mts` запрашивает настоящий readiness через origin
   web; mock не заменяет БД. Review и совместная приёмка остаются отдельными шагами.

Проверки пакета покрывают JSON round-trip, недопустимые состояния и утечку
внутренних полей, безопасный текст ошибки и UUID, а также отсутствие Node/server
импортов в транзитивном ESM-графе публичных exports (включая Zod).
API-тест импортирует compiled workspace package; web использует те же схемы.

## Границы Foundation

PostgreSQL/Prisma и изоляция dev/test описаны в [Database Foundation](database.md).
Mailpit настроен в Compose, инструкции и границы фактических проверок — в
[FND-03](local-environment.md). Это не подтверждает чистый Compose-запуск обоими
разработчиками или готовую отправку писем из NestJS.
Web-интеграция и CI реализованы; полный Foundation требует их review и
совместной приёмки FND-08.
Auth, прикладные модели и миграции пока отсутствуют.

## Проверки FND-02 — 2026-10-21

Исторический отчёт на момент реализации FND-02, до добавления frontend harness
и FND-04. Более поздние результаты: [frontend review](fnd-02-review.md),
[локальное окружение](local-environment.md) и [readiness/Swagger](api-readiness.md).

| Проверка | Результат |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | PASS, новых скачиваний нет |
| `pnpm check-types` | PASS: contracts TS 5.9.3, web TS 5.9.3, API TS 6.0.3 |
| `pnpm lint` | PASS во всех трёх пакетах |
| `pnpm test` | PASS: 8 API тестов и файл контрактных тестов |
| `node packages/contracts/test/contracts.test.mjs` | PASS: 4 контрактных сценария, включая транзитивный граф импортов |
| `pnpm test:e2e` | PASS: 1 стартовый API e2e; contracts build учтён Turbo |
| Contracts/API build и импорт compiled API ESM entry | PASS |
| `pnpm build` / прямой Next.js Turbopack build | FAIL из-за среды: CSS worker не может открыть локальный сокет (`EPERM`), включая повтор с escalation |
| `pnpm --filter @instagram/web exec next build --webpack` | PASS: production build и TypeScript на том же приложении |
| Prisma validate/generate | PASS; моделей и SQL-миграций нет |
| Docker Compose cold start / browser smoke | NOT RUN: Docker и browser harness отсутствуют |

Успешный Webpack build не объявляется успешным штатным Turbopack build. Перед
совместной приёмкой нужно повторить `pnpm build` на машине без этого ограничения.
В этом срезе UI-поведение и реальные запросы readiness не проверялись: маршрут
был добавлен позднее в FND-04.
Проверки настоящей PostgreSQL выполнены в предшествующем review Database Foundation;
срез FND-02 не меняет код соединений, роли или схему БД.
