# FND-05 — Web и настоящий API

Responsive shell и REST-клиент дополнены интеграцией по
[согласованному baseline](foundation-baseline.md). API остаётся NestJS; Next.js
не получает доступ к Prisma или БД и не создаёт собственную авторизацию.
Контракт readiness не изменён.

## Маршрутизация и конфигурация

Браузер открывает `http://localhost:3000` и отправляет относительные запросы
`/api/v1/*`. Rewrite из `apps/web/next.config.ts` передаёт их NestJS с сохранением
пути и query. Дополнительный CORS-режим и публичный адрес backend не нужны.
Swagger остаётся на API: `http://localhost:4000/api/docs/`.

Внутренний адрес задаётся серверной переменной `API_INTERNAL_ORIGIN`, по умолчанию
`http://127.0.0.1:4000`. Это полный HTTP(S) origin без userinfo, пути, query или
fragment. Некорректная конфигурация вызывает ошибку без вывода её значения.
Адрес не берётся из входящих Host/Forwarded headers, не передаётся в клиентские
props и не объявляется через `NEXT_PUBLIC_*`.

Для другого адреса экспортируйте переменную перед запуском:

```bash
export API_INTERNAL_ORIGIN=http://127.0.0.1:4100
pnpm dev:web
```

Либо задайте её в игнорируемом `apps/web/.env.local`. Next читает web env-файлы;
корневой `.env` для API/Prisma не загружается в web автоматически. Адрес должен
соответствовать реально запущенному API. После изменения перезапустите Next.
Для production build и запуска используйте согласованное значение: rewrites
сохраняются в build manifest. Turbo учитывает переменную в hash/pass-through,
а env-файлы пакетов включены в inputs сборки.

Локальный запуск с портами по умолчанию:

```bash
docker compose up -d --wait postgres
pnpm dev
```

Инструкции настройки БД и Mailpit: [FND-03](local-environment.md).
Deployment сохраняет общий HTTPS origin с маршрутизацией API непосредственно
в NestJS. Этот срез не подтверждает production proxy, cookie-auth или SSE.

## Браузерный клиент

В клиентском коде используйте существующий относительный клиент:

```ts
import { createApiClient } from '@/lib/api/client';
import { getReadiness } from '@/lib/api/readiness';

const result = await getReadiness(createApiClient());
```

Запросы имеют `credentials: same-origin`, `cache: no-store`, проходят общую
Zod-схему и возвращают `ApiResult`. Для ошибки UI использует `describeFailure`,
а не внутренний текст драйвера. Неконтрактный ответ proxy, сетевой сбой и
отмена различимы; автоматического переключения на fixture нет.

## Серверный клиент

В Server Components/серверном коде внутри запроса:

```ts
import { createServerApiClient } from '@/lib/api/server';
import { getReadiness } from '@/lib/api/readiness';

const result = await getReadiness(await createServerApiClient());
```

`server-only` запрещает импорт этого entry в Client Components. Фабрика читает
асинхронный `headers()` Next и создаёт отдельный клиент для текущего запроса.
Cookie и Origin передаются только настроенному API. Host, Authorization и
прочие входящие заголовки автоматически не копируются. Redirect запрещён,
чтобы не переносить контекст сессии на новый адрес. Общий клиент сохраняет
`no-store`, контрактную проверку ответа и отмену запроса.

Не сохраняйте этот клиент в module singleton, `use cache` или общий кеш.
При Cache Components вызовы request-time API в компоненте должны быть внутри
`Suspense` согласно Next.js. Передача Cookie не реализует auth: сессии, CSRF,
auth-операции и обработка Set-Cookie из Server Actions остаются этапом 2.

## Fixtures и проверки

Fixture-клиент выбирается только явным `createFixtureClient(...)`; его
`mode: fixture` отличается от `mode: live`. Главная страница по-прежнему
показывает design mock-данные: профили, посты и лента относятся к будущим этапам.
Диагностическая страница или статус БД в пользовательский UI не добавлены.

Unit-тесты проверяют адрес и rewrite, безопасный отказ неверной конфигурации,
передачу и изоляцию контекста запросов, ошибки и отмену. Playwright readiness
больше не `fixme`: настоящий браузер запрашивает `/api/v1/readiness` на origin
web и проверяет 200, `no-store` и общую Zod-схему. Ответ не перехватывается и не
подменяется fixture. Нужны работающие PostgreSQL и API; без них тест падает.

Из корня после запуска PostgreSQL и API:

```bash
pnpm check-types
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Playwright запускает web сам (локально может переиспользовать работающий web).
В [CI](ci.md) PostgreSQL и API уже запускаются до browser checks. Настоящие
API 200/503 с PostgreSQL проверяются также отдельным `test:integration`.
Совместная приёмка FND-08, review и auth-сценарии этим срезом не закрываются.

## Проверки реализации — 2026-10-21

Результаты FND-05 до добавления error component tests FND-06; дополнительные
проверки frontend описаны в [FND-06](frontend-testing.md).

| Проверка | Результат |
| --- | --- |
| `pnpm check-types`, `pnpm lint` | PASS во всём workspace |
| `pnpm test` | PASS: 26 web (включая 12 новых), 8 API, 4 contracts |
| `pnpm --filter @instagram/api test:integration` | PASS: 6 тестов на настоящей PostgreSQL 18.6 |
| `CI=true pnpm test:e2e` с PostgreSQL/API и Chromium Playwright | PASS: 4 API и 6 browser checks; 2 browser skips только по размеру экрана |
| Настоящий Next Server Component с `createServerApiClient` | PASS: получен 200 от NestJS/PostgreSQL; временная проверочная страница затем удалена |
| Настоящий отказ CONNECT тестовой роли к dev БД | PASS: web proxy и серверный клиент вернули безопасный 503 вместо предыдущего 200; БД не останавливалась |
| Изменение `API_INTERNAL_ORIGIN` в Turbo dry run | PASS: hash web build меняется |
| API build и `NODE_USE_ENV_PROXY=1 pnpm --filter @instagram/web exec next build --webpack` | PASS |
| Штатный `pnpm build` | FAIL: известная проблема загрузки Google Fonts через Turbopack/proxy облачной машины |

Webpack не заменяет обязательный штатный build в CI. Для изменений нужно
подтвердить отдельный GitHub run и указать результат в PR; успешный run FND-07
не засчитывается как проверка новых изменений. Проверки auth/cookie-сессий и
production deployment не выполнялись и не объявляются готовыми.
