# FND-06 — Frontend и сквозные проверки

Используются уже выбранные инструменты: Vitest + Testing Library (jsdom) для
компонентов, Node environment для API-клиента и Playwright для desktop/mobile.
Новых зависимостей и отдельной диагностической страницы нет. Команды запускаются
из корня workspace; [FND-05](web-api.md) описывает настоящий API и origin.

## Компонентные и unit-проверки

```bash
pnpm test
# Только frontend, после pnpm --filter @instagram/contracts build:
pnpm --filter @instagram/web test
```

- Shell: доступные имена навигации, текущий раздел, мобильные ссылки.
- UI главной: существующие взаимодействия карусели.
- `ApiErrorNotice`: доступный `role=alert`, локализованные сообщения для API,
  сети, невалидного ответа и отмены; нет raw backend message/requestId;
  кнопка повтора появляется только с callback и работает с клавиатуры.
- REST-клиент: общие Zod-схемы, 503, неизвестный/не-JSON ответ, отмена,
  `same-origin` и `no-store`. Fixture-клиент имеет явный `mode: fixture`,
  настоящий клиент — `mode: live`; автоматической подмены нет.
- Серверный клиент: внутренний origin, Cookie/Origin только текущего запроса,
  отсутствие общего session context и запрет redirect с этим контекстом.

`ApiErrorNotice` — компонент для обработчиков неуспешных запросов, а не проверка
доступности БД. Он сам не отправляет запросы и не добавляется на главную как
технический индикатор. Auth и прикладные формы используют его в будущих срезах.

## Настоящий browser smoke

Подготовьте PostgreSQL и API по [локальной инструкции](local-environment.md).
API должен работать на порту 4000 или соответствовать `API_INTERNAL_ORIGIN`.
Установите браузер согласно [baseline](foundation-baseline.md): локально Google
Chrome/`PLAYWRIGHT_CHANNEL`, в CI Chromium Playwright.

```bash
pnpm test:e2e
```

Playwright запускает web на 3000; локально может использовать уже работающий web.
В CI повторное использование отключено. Shell проверяется на desktop/mobile;
hover-тест сначала отводит указатель от панели и ждёт её сворачивания.

`e2e/readiness.spec.mts` выполняет fetch из настоящего браузера к относительному
`/api/v1/readiness`, затем проверяет 200, `no-store` и общий Zod-контракт.
Запрос проходит Next rewrite → NestJS → SQL-запрос к PostgreSQL. Request routing,
fixtures и постоянный mock для успешного результата не используются. Отсутствие
API/БД или неправильный proxy делает тест неуспешным, а не skipped.
ESM entry нужен для ESM-only `@instagram/contracts`, без изменения exports пакета.

Ожидаются 6 успешных browser checks и 2 skips только для неприменимого viewport:
desktop rail на mobile и bottom nav на desktop. Readiness не пропускается.
Настоящий безопасный отказ БД 503 дополнительно покрывается API integration tests;
компонентные fixture-тесты ошибок не выдаются за сквозной отрицательный сценарий.

## CI и границы приёмки

[Foundation CI](ci.md) устанавливает Chromium с системными зависимостями,
запускает PostgreSQL и скомпилированный API, затем корневой E2E. Vitest и
Playwright возвращают ненулевой код при ошибке и не разрешают пустой набор тестов.
`test.only` запрещён в CI, при сбое сохраняются browser traces на 7 дней.

Review обоими разработчиками, чистый запуск на их машинах и общая приёмка
остаются FND-08. Foundation smoke не подтверждает auth, приватность публикаций,
почту, production SSE или продуктовые сценарии с демонстрационной главной.

## Проверка реализации — 2026-10-21

`pnpm check-types`, `pnpm lint` и `pnpm test` прошли: 31 web test (включая
5 компонентных проверок ошибки), 8 API и 4 contract tests. Сквозной набор
FND-05/FND-06 прошёл с настоящей PostgreSQL, API и Chromium Playwright:
4 API E2E и 6 browser checks, 2 viewport skips. Подробные проверки настоящего
Server Component и отказа БД 503 приведены в [FND-05](web-api.md).
Штатная Turbopack-сборка в облачной машине ограничена загрузкой Google Fonts
через прокси; обязательный build сохраняется в GitHub CI. Результат отдельного
GitHub run для изменений фиксируется в PR; локальные проверки его не заменяют.
