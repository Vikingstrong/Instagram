# Database Foundation

Срез готовит PostgreSQL и Prisma для дальнейшей работы. Подключение к NestJS,
readiness и Swagger относятся к следующим задачам; общие контракты подготовлены
в [FND-02](foundation-contracts.md). Прикладных
моделей и SQL-миграций пока нет. Это не завершение всего FND-01/FND-03/FND-04:
согласование browser runner/origin и локальная почта остаются отдельной работой.

## Версии и размещение

- Node.js — из `.nvmrc`; pnpm — из корневого `packageManager`.
- PostgreSQL — **18.6**, образ команды — `postgres:18.6-bookworm`
  ([официальный список тегов](https://github.com/docker-library/official-images/blob/master/library/postgres)).
- `prisma`, `@prisma/client`, `@prisma/adapter-pg` — строго **7.10.1**.
- Schema: `apps/api/prisma/schema.prisma`; будущая история миграций:
  `apps/api/prisma/migrations/`.
- Prisma 7 CLI получает URL из `apps/api/prisma.config.ts`, а не из schema.
  Конфигурация читает корневой `.env`; переменные процесса имеют приоритет.
- Запуск API (`start`, `start:dev`, `start:debug`, `start:prod`) читает тот же
  корневой `.env` через Node.js `--env-file-if-exists`; сейчас приложение
  использует `PORT`, но не подключается к БД до FND-04. При отсутствии файла
  можно передать переменные непосредственно процессу.
- Генератор `prisma-client` создаёт TypeScript в
  `apps/api/src/generated/prisma/`. Каталог исключён из Git. ESM и `.js`-суффиксы
  импортов совместимы с существующим NodeNext и скомпилированным NestJS.
- Для CLI нужны разрешённые build scripts `prisma` и `@prisma/engines` в
  `pnpm-workspace.yaml`. Остальные ограничения build scripts сохраняются.

Ссылки на используемое API Prisma 7:
[generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators),
[config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference),
[pool](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool).

## Настройка для второго разработчика

Все команды ниже выполняются **из корня репозитория**.

```bash
nvm use
pnpm install --frozen-lockfile
pnpm --filter @instagram/contracts build
cp .env.example .env
```

Замените placeholders в `.env` собственными локальными паролями. Администратор,
dev и test используют разные пароли. В `DATABASE_URL` и `TEST_DATABASE_URL`
пароли должны соответствовать `POSTGRES_DEV_PASSWORD` и
`POSTGRES_TEST_PASSWORD`; специальные символы в URL нужно percent-encode.
Пример не содержит рабочих секретов. `.env` не коммитится.

### Compose

Если Docker Compose уже установлен:

```bash
docker compose up -d --wait postgres
```

Сервис доступен только на `127.0.0.1:${POSTGRES_PORT}`. Образ PostgreSQL 18
использует versioned PGDATA, поэтому volume монтируется в `/var/lib/postgresql`.
При первом запуске `scripts/database/init.sh` создаёт:

| База | Роль-владелец | URL |
| --- | --- | --- |
| `instagram_dev` | `instagram_dev` | `DATABASE_URL` |
| `instagram_test` | `instagram_test` | `TEST_DATABASE_URL` |

Прикладные роли не являются superuser, не создают роли или базы. `PUBLIC` не
имеет прав на эти базы; тестовая роль не может подключиться к dev и наоборот.
Администратор используется только для инициализации, не для Prisma Client.
Init-скрипт читает пароли через `psql \getenv`: значения не передаются в
аргументах процесса `psql`.

Init-скрипт выполняется только при создании нового volume. Изменение паролей в
`.env` не меняет существующие роли. Повторно запускать init на существующей БД
не нужно; он не сбрасывает данные и завершится ошибкой при конфликте имён.

Остановка с сохранением данных:

```bash
docker compose stop postgres
```

Compose здесь должен проверяться отдельно от native PostgreSQL. Успешный native
тест не подтверждает запуск контейнера.

### Существующий PostgreSQL без Docker

Нужны установленные бинарники PostgreSQL **18.6**: `initdb`, `pg_ctl`, `psql`.
Создавайте отдельный локальный кластер, не используйте общий или production.
Пример для Linux, нового каталога и свободного порта 55432:

```bash
export INSTAGRAM_PG_DIR="$(mktemp -d /tmp/instagram-postgres.XXXXXX)"
initdb -D "$INSTAGRAM_PG_DIR/data" --encoding=UTF8 --locale=C.UTF-8 \
  --auth-local=trust --auth-host=scram-sha-256
pg_ctl -D "$INSTAGRAM_PG_DIR/data" -l "$INSTAGRAM_PG_DIR/postgres.log" \
  -o "-h 127.0.0.1 -p 55432 -k $INSTAGRAM_PG_DIR" -w start
```

Локальный socket защищён приватным каталогом `mktemp`; TCP использует SCRAM.
В `.env` установите порт **55432** в обоих URL и `POSTGRES_PORT`. Для создания
двух баз выполните один раз на этом новом кластере:

```bash
PGHOST="$INSTAGRAM_PG_DIR" PGPORT=55432 \
node --env-file=.env --input-type=module <<'JS'
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
const result = spawnSync('sh', ['scripts/database/init.sh'], {
  stdio: 'inherit',
  env: { ...process.env, POSTGRES_USER: userInfo().username },
});
process.exit(result.status ?? 1);
JS
```

После работы остановите только этот кластер:

```bash
pg_ctl -D "$INSTAGRAM_PG_DIR/data" -m fast -w stop
```

## Проверки и запуск

При работающей БД и настроенном `.env`:

```bash
pnpm --filter @instagram/api db:validate
pnpm --filter @instagram/api db:generate
pnpm --filter @instagram/api db:migrate:test
pnpm --filter @instagram/api db:check
pnpm --filter @instagram/api db:check --test
pnpm --filter @instagram/api test:integration
pnpm check-types
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
pnpm dev
```

`db:check` сначала собирает API, затем **Node.js импортирует скомпилированный
ESM Prisma Client**, выполняет `$connect()` и `SELECT 1`, закрывает pool. Ошибка
даёт ненулевой exit code. При отсутствующем/некорректном URL сообщение называет
переменную без её значения; ошибка подключения не раскрывает URL, пароль или
driver error.
Обычный NestJS пока не использует БД; его `GET /` не является readiness.

`test:integration` — отдельная явная команда, не часть стартовых `test` или
`test:e2e`. Использует настоящий PostgreSQL, проверяет версию 18.6,
параметризованный SQL, идентичность test БД/роли, отсутствие административных
прав и прямой отказ доступа к dev. Отсутствующая test-конфигурация или одинаковые
имена баз/ролей приводят к FAIL, а не SKIP. Параметры URL, способные
переопределить host, port, user, password или database, запрещены для обоих
подключений. Никаких reset/truncate в тестах нет.

Проверка пустой схемы рассчитана на текущий Foundation. При добавлении первой
согласованной модели её нужно заменить проверками новой схемы и ограничений.

## Процесс миграций

`db:migrate:test` использует отдельный `prisma.test.config.ts`, проверяющий
различие dev/test до подключения. `db:migrate:deploy` использует dev URL.
Обе команды применяют только существующую историю, не создают миграции и не
вызывают reset. Сейчас ожидается **0 миграций**. Это проверяет доступность
migration tooling на реальной БД, но не доказывает применение прикладной SQL-миграции.

При Auth-срезе после согласования контракта появятся первые модели и миграции.
Для `migrate dev` потребуется отдельно подготовленная shadow database; текущим
прикладным ролям намеренно не выдан CREATEDB. SQL проходит review до применения;
миграции не запускаются при старте каждого API-процесса. `db push` не заменяет
версионируемые миграции.

FND-02 подготовлен для review frontend-разработчиком. FND-04 позже подключит NestJS lifecycle,
readiness и Swagger/OpenAPI с реальными ответами согласованного контракта.

## Результаты проверки этого среза — 2026-10-21

Это результаты Database Foundation до добавления FND-02. Актуальные проверки
общего пакета и workspace, включая ограничение Turbopack в текущей среде, см. в
[отчёте FND-02](foundation-contracts.md#проверки-fnd-02--2026-10-21).

Проверки БД выполнены на временных native-кластерах PostgreSQL 18.6,
с разными dev/test ролями и случайными временными паролями. Финальное ревью
также проверяет обновлённый init-скрипт на отдельном чистом кластере.
После проверки кластеры остановлены, временные данные и пароли удалены.

| Проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| Prisma validate / generate 7.10.1 без database credentials | PASS |
| `db:migrate:deploy` и `db:migrate:test` на реальной БД | PASS, 0 миграций; прикладной SQL не применялся |
| `db:check` и `db:check --test` | PASS: compiled ESM import, connect, SELECT, disconnect |
| Скомпилированный CLI после остановки БД | PASS: exit 1, безопасное сообщение без credentials |
| Загрузка `.env` из root и `apps/api`; запуск API с `PORT` из файла/процесса | PASS, реальный `GET /` для start, start:prod и dev:api |
| Dev/test роли и права | PASS: у обеих нет superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS или доступа к другой БД |
| Обновлённый init-скрипт с `psql \getenv` | PASS на чистом native-кластере, подтверждена SCRAM-аутентификация |
| Ошибки отсутствующих URL и запрещённый `?user=` | PASS: exit 1, имя переменной без credentials; миграция отклонена до подключения |
| `test:integration` | PASS, 4 теста на настоящей PostgreSQL |
| `pnpm test` | PASS, 7 API unit-тестов |
| `pnpm test:e2e` | PASS, 1 стартовый API e2e-тест |
| `pnpm check-types` | PASS, оба приложения |
| `pnpm lint` / `pnpm build` | PASS; API выполнены заново, web использовал Turbo cache |
| `sh -n`, Prettier, `git diff --check` | PASS; YAML разобран Prettier, это не запуск Compose |
| Docker Compose startup / healthcheck / volume initialization | **NOT RUN**: Docker отсутствует; установленный Podman не запускается в доступном окружении |

Проверки стартового API не доказывают интеграцию NestJS с БД; она относится к
FND-04. Frontend/browser тесты по-прежнему не настроены. Для совместной приёмки
требуются запуск по этой инструкции вторым разработчиком и отдельная проверка
Compose на машине с рабочим container runtime.

Ревью обнаружило конкретные пароли в отслеживаемом `.env.example` коммита
`00da55d`. Рабочая версия файла теперь содержит только placeholders. По указанию
пользователя коммит удалён из ветки `feat/api-database` с сохранением всех
рабочих файлов. Локальный reflog может сохранять старый
объект для восстановления. Пароли нужно заменить, если они использовались.

## Файлы этого изменения

| Файлы | Назначение |
| --- | --- |
| `.env.example`, `compose.yaml`, `scripts/database/init.sh` | Воспроизводимое окружение и изолированные базы/роли |
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/README.md` | Схема без моделей и документированный процесс будущих миграций |
| `apps/api/prisma.config.ts`, `apps/api/prisma.test.config.ts` | Отдельные dev/test настройки Prisma CLI |
| `apps/api/src/infrastructure/database/database.config.ts` | Безопасная конфигурация подключений и защита от совпадения dev/test |
| `apps/api/src/infrastructure/database/database.client.ts` | Prisma Client factory с PostgreSQL adapter и ограниченным pool |
| `apps/api/src/infrastructure/database/check-database.ts` | Проверка скомпилированного ESM-клиента и настоящего SQL-запроса |
| `apps/api/src/infrastructure/database/database.config.spec.ts` | Unit-проверки защиты конфигурации |
| `apps/api/test/database.integration-spec.ts`, `apps/api/vitest.config.integration.ts` | Отдельные тесты реальной PostgreSQL |
| `apps/api/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Точные зависимости, явные команды и разрешённые build scripts Prisma |
| `.gitignore`, `apps/api/.oxlintrc.json` | Исключение generated client из Git и lint |
| `AGENTS.md`, `apps/api/README.md`, `docs/architecture/overview.md`, `docs/roadmap.md`, `docs/development/database.md` | Актуальные команды, границы среза, передача разработчику и планирование Swagger |
