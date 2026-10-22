# FND-04 — Readiness и Swagger

Реализован backend технического среза по принятому
[FND-02 контракту](foundation-contracts.md) и
[frontend review](fnd-02-review.md). Общие wire-схемы, поля, статусы и fixtures
не изменены. Модели и прикладные миграции не добавлены.

## Запуск и адреса

Подготовьте [локальное окружение](local-environment.md), задайте настоящий
`DATABASE_URL` в корневом `.env` и запустите из корня:

```bash
pnpm dev:api
```

| Назначение | Адрес по умолчанию |
| --- | --- |
| Swagger UI | `http://localhost:4000/api/docs/` |
| OpenAPI JSON | `http://localhost:4000/api/docs/openapi.json` |
| Readiness | `http://localhost:4000/api/v1/readiness` |

В Swagger откройте **Foundation → GET /api/v1/readiness → Try it out → Execute**.
Запрос отправляется настоящему NestJS. Readiness не требует сессии.
Стартовый `GET /` сохранён для совместимости со scaffold; он исключён из Swagger
и не проверяет БД. Порт API по умолчанию 4000; `PORT` остаётся переопределением
для изолированных проверок и deployment.

## Поведение

`DatabaseModule` создаёт один `DatabaseService` с Prisma Client и `PrismaPg`.
URL проверяется при создании приложения; отсутствующий, placeholder или
некорректный `DATABASE_URL` останавливает старт с безопасной ошибкой конфигурации.
Подключение к PostgreSQL ленивое: корректный URL недоступной БД не мешает поднять
HTTP и Swagger. Readiness выполняет `SELECT 1` при каждом запросе.

- Доступная БД: HTTP 200, `{"status":"ready"}`.
- Ошибка запроса/подключения: HTTP 503, согласованный `SERVICE_UNAVAILABLE`
  с безопасным текстом и новым UUID v4 в `requestId`.
- Оба ответа имеют `Cache-Control: no-store`; URL, пароли и driver error не
  возвращаются и не логируются обработчиком readiness.
- При восстановлении БД следующий запрос может снова вернуть 200.
- Shutdown hooks отключают Prisma pool при закрытии приложения/SIGTERM.

Настройки pool/таймаутов остаются в `database.client.ts`. Сервис не выполняет
миграции на старте. `TEST_DATABASE_URL` используется только явными проверками,
а не для автоматического выбора рабочей БД.

## Swagger и границы контракта

Добавлен официальный `@nestjs/swagger` 12.0.2, совместимый с NestJS 12;
[официальная инструкция](https://docs.nestjs.com/openapi/introduction).
Описания response schema генерируются из существующих Zod-схем через
`toJSONSchema({ target: 'openapi-3.0' })`; отдельные DTO-копии не создаются.
Swagger UI использует локальные assets. В `pnpm-workspace.yaml` явно запрещён
необязательный install-скрипт транзитивного `@scarf/scarf`; разрешения других
build scripts не ослаблены.

Согласованный контракт пока содержит только `SERVICE_UNAVAILABLE`.
Глобальный конверт для 400/404/500 и соответствующие коды из вопроса frontend
review ещё требуют согласования. Этот срез не объявляет стандартные ошибки
NestJS совместимыми с `ApiErrorResponseSchema`. Строгие схемы сохраняются:
расширение ответа требует синхронного изменения producers, consumers и fixtures.

Proxy в Next.js и реальный browser → web → API → DB smoke ещё не реализованы.
Swagger доступен напрямую на origin API; это не подтверждение frontend-интеграции.
FND-01/FND-03 готовы к оставшимся review/проверкам окружения; ожидание второго
разработчика не мешает разработке этого backend-среза, но не заменяет его приёмку.

## Автоматическая проверка Swagger в браузере

`apps/web/e2e/swagger.spec.mts` использует существующий Playwright harness и
проверяет настоящий Swagger UI на desktop/mobile. Тест открывает операцию
`getReadiness`, нажимает **Try it out → Execute**, дожидается HTTP-ответа и
проверяет отрисованный статус, общий Zod-контракт и `Cache-Control: no-store`.
Ответ не подменяется fixture или перехватом запроса.

- С доступной PostgreSQL операция возвращает 200.
- Для 503 тест создаёт отдельный Nest-процесс с конфигурацией запрета CONNECT
  тестовой роли к dev-базе. Порт выбирается ОС; процесс останавливается в
  `finally`. Общие API, БД и права ролей не изменяются.
- API HTTP-тест дополнительно сверяет `operationId`, тег Foundation и
  документированные заголовки 200/503 с контрактом.

Для запуска нужны PostgreSQL с изоляцией dev/test, корневой `.env`
(значения процесса имеют приоритет), собранный API и настроенный Playwright браузер.
Из корня, при работающем основном API на порту 4000:

```bash
pnpm --filter @instagram/contracts build
pnpm --filter @instagram/api build
pnpm --filter @instagram/web exec playwright test swagger.spec.mts
```

В CI эти четыре browser checks входят в существующий `pnpm test:e2e` после
сборки и старта API/PostgreSQL. Проверка идёт напрямую на origin API, поэтому
не зависит от merge web proxy или других изменений FND-05/FND-06. Новые
зависимости, контрактные коды, endpoint или глобальный exception filter не
добавлены. Совместное review и приёмка остаются отдельными шагами.

## Проверки — 2026-10-21

| Проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS после явного запрета необязательного Scarf install script |
| `pnpm check-types` | PASS, оба приложения и contracts |
| `pnpm lint` | PASS; web/contracts использовали Turbo cache |
| `pnpm test` | PASS: 8 API, 4 contract, 14 web тестов |
| `pnpm build` | PASS: API собран заново, неизменённые web/contracts — Turbo cache |
| `pnpm --filter @instagram/api test:e2e` | PASS: 4 HTTP-теста; БД подменена для детерминированной проверки 200/503 и Swagger |
| `pnpm --filter @instagram/api test:integration` | PASS: 6 тестов на изолированной PostgreSQL 18.6, включая настоящий HTTP readiness и отказ CONNECT |
| Скомпилированный `dist/main.js` по HTTP | PASS: Swagger UI/assets/OpenAPI и readiness 200 на настоящей PostgreSQL |
| Остановка/восстановление временной БД при работающем API | PASS: 200 → безопасный 503 без кеширования → 200 |
| Холодный старт с недоступной БД | PASS: API/Swagger доступны, readiness возвращает 503 |
| Завершение API через SIGTERM | PASS: процесс завершился в пределах shutdown timeout |

Для реальных проверок создан отдельный временный контейнер Podman с новыми
данными и случайными credentials. Рабочий `.env` и существующие БД не менялись.
Контейнер, временные данные и credentials после проверки удалены.
Docker Compose, браузерные тесты и review второго разработчика в этом срезе
не выполнены и не засчитываются как PASS. Для полного закрытия Foundation
нужна совместная приёмка. Более поздняя web-интеграция описана в
[FND-05](web-api.md), автоматизация — в [CI](ci.md).
