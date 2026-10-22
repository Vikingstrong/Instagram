# FND-03 — Локальное окружение

Версии, порты приложений и workflow: [FND-01](foundation-baseline.md).
PostgreSQL, изоляция dev/test, подготовка ролей, миграции и проверки соединения:
[Database Foundation](database.md). Эта инструкция не подтверждает выполнение
чистого запуска обоими разработчиками.
До окончательной приёмки этапа 2 выполните и зафиксируйте проверки на реальных
ПК по [чек-листу FND-08](foundation-acceptance.md). Владелец разрешил начать
разработку Auth до FND-08; облачный CI не заменяет проверки ноутбуков.

## Подготовка и запуск

Из корня репозитория, с установленными Node из `.nvmrc` и Docker Compose:

```bash
nvm use
pnpm install --frozen-lockfile
```

Если корневого `.env` ещё нет, скопируйте `.env.example` в `.env`. Существующий
файл не перезаписывайте. Замените placeholders паролей и согласуйте URL БД
по инструкции Database Foundation. Для существующего `.env` при необходимости
добавьте `MAILPIT_SMTP_PORT=1025` и `MAILPIT_UI_PORT=8025`; это также значения
Compose по умолчанию.

```bash
docker compose up -d --wait postgres mailpit
pnpm dev
```

Web ожидается на `http://localhost:3000`, API — на `http://localhost:4000`.
Readiness и Swagger реализованы в [FND-04](api-readiness.md).
Proxy `/api/v1/*` и серверный web-клиент реализованы в [FND-05](web-api.md).
Для native PostgreSQL следуйте отдельной инструкции, а почту запускайте через
`docker compose up -d --wait mailpit` с тем же подготовленным `.env`.

Перед запуском можно проверить наличие runtime и синтаксис конфигурации:

```bash
docker version
docker compose version
docker compose config --quiet
```

`config --quiet` не печатает подставленные пароли. Нужны свободные порты
3000/4000, PostgreSQL и Mailpit; не останавливайте чужие процессы ради проверки.
Не смешивайте `localhost` и `127.0.0.1` в браузерных URL приложения: согласованный
origin — `http://localhost:3000`.

## Тестовая почта

Владелец проекта согласовал Mailpit в Compose. Закреплён образ
`axllent/mailpit:v1.31.5`; healthcheck использует `/mailpit readyz`.
Источники: [релиз](https://github.com/axllent/mailpit/releases/tag/v1.31.5),
[официальный Dockerfile](https://github.com/axllent/mailpit/blob/v1.31.5/Dockerfile),
[Docker-инструкция](https://mailpit.axllent.org/docs/install/docker/).

| Назначение | Значение по умолчанию |
| --- | --- |
| Просмотр писем | `http://localhost:8025` |
| SMTP для API, запущенного на хосте | `127.0.0.1:1025`, без TLS и авторизации, только локальная разработка |
| Проверка готовности | `http://localhost:8025/readyz` |

Оба порта опубликованы только на loopback. Настройки relay/forwarding не
добавляются: сервис принимает тестовые письма для локального просмотра.
SMTP-адаптер API пока отсутствует и появится в этапе auth/email; переменные
`MAILPIT_*` управляют портами Compose, NestJS их сейчас не использует.
Изменение SMTP-порта нужно будет учесть в будущей конфигурации отправителя.

Для Mailpit не создаётся постоянный volume: содержимое временное и может
исчезнуть при пересоздании контейнера. Dev/test используют один локальный
mailbox; при будущих автоматических email-тестах нужны уникальные получатели
для каждого запуска. Глобальная очистка inbox параллельными тестами недопустима.
Публичная доставка verification/recovery этим сервисом не решается.

### Ручная SMTP-проверка

При работающем Mailpit, с установленным `curl` (порты по умолчанию):

```bash
curl --fail --silent --show-error http://localhost:8025/readyz
curl --fail --silent --show-error --url smtp://127.0.0.1:1025 \
  --mail-from foundation@example.test \
  --mail-rcpt foundation-smoke@example.test --upload-file - <<'MAIL'
From: foundation@example.test
To: foundation-smoke@example.test
Subject: Foundation local SMTP smoke

Local Foundation check, no real user data.
MAIL
```

Откройте `http://localhost:8025` и найдите новое письмо с указанной темой и
получателем. При изменённых `MAILPIT_*` используйте соответствующие порты.
Это проверяет SMTP и mailbox, но не отправку из NestJS. Для проверки БД
выполните `db:check`, `db:check --test` и `test:integration` по
[инструкции](database.md#проверки-и-запуск); вывод CLI безопасен, URL не печатаются.

## Остановка и данные

```bash
docker compose stop postgres mailpit
```

Остановка сохраняет PostgreSQL volume. Не используйте `docker compose down -v`
для очистки почты: эта команда затронет и данные БД. Письма можно удалить через
UI Mailpit, убедившись, что они не нужны другому локальному запуску.
Dev/test БД изолированы разными базами и ролями; существующая инструкция не
разрешает сброс dev, общих или production-данных.

При приёмке FND-03 ещё требуется фактически проверить Compose на машинах
разработчиков. Mailbox, SMTP и изоляция БД проверены в текущей среде через
отдельные контейнеры Podman, как описано ниже. Интеграция
браузер → API → PostgreSQL относится к последующим задачам Foundation.

## Результаты проверки — 2026-10-21

Это результаты FND-01/FND-03 до добавления readiness; более поздние проверки
API приведены в [отчёте FND-04](api-readiness.md).

Проверка вне sandbox подтвердила: Docker CLI, стандартный Docker socket и
Compose providers здесь недоступны. Podman 5.8.7 работает вне sandbox; это
отличается от ограничений, зафиксированных в историческом отчёте Database
Foundation. Системный Docker не устанавливался.

Использованы отдельные временные контейнеры согласованных образов, свободные
loopback-порты 55439 (PostgreSQL), 11039/18039 (Mailpit), временные случайные
пароли и новые данные. Рабочий `.env` не создавался и не менялся.

| Проверка | Результат |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; версии и lockfile не изменены |
| `pnpm check-types` | PASS после установки зависимостей из обновлённой ветки и удаления устаревших generated Next types |
| `pnpm lint` | PASS; контрактная задача использовала Turbo cache |
| `pnpm test` | PASS: 8 API, 4 contract и 14 web тестов |
| `pnpm build` | PASS: API и web собраны заново, contracts использовали Turbo cache |
| `pnpm --filter @instagram/api test:e2e` | PASS: 1 стартовый API-тест; не readiness |
| Playwright `test --list` | Обнаружено 8 записей desktop/mobile, включая pending readiness; это не запуск браузера |
| Mailpit `/mailpit readyz`, HTTP `/readyz` и UI | PASS в отдельном контейнере Podman |
| SMTP → Mailpit API | PASS: новое письмо с уникальным получателем найдено в mailbox |
| PostgreSQL 18.6 и repository init-скрипт | PASS в отдельном контейнере после исправления SELinux mount на `:ro,Z` |
| `pnpm --filter @instagram/api test:integration` | PASS: 4 теста реальной PostgreSQL, включая права test-роли и отказ test → dev |
| Обратный доступ dev → test | PASS: прямое подключение отклонено PostgreSQL |
| Compiled ESM `check-database.js` для dev/test | PASS: соединение и настоящий SQL |
| `db:migrate:deploy` / `db:migrate:test` | PASS на временных БД, 0 миграций; прикладной SQL не проверялся |
| Compiled CLI при остановленной БД | PASS: exit 1, безопасное сообщение без URL |
| YAML Prettier, `sh -n`, локальные ссылки и `git diff --check` | PASS; YAML parse не заменяет Compose validation |
| Docker Compose `config` / startup / named volume | NOT RUN: CLI/provider отсутствуют; отдельные `podman run` не доказывают работу Compose |
| Playwright browser run | NOT RUN: локальный Chrome/Chromium отсутствует; для этого инфраструктурного изменения браузер не устанавливался |
| Чистый checkout на второй машине и review Developer 2 | Ещё требуются для совместной приёмки |

Первый запуск PostgreSQL без SELinux-метки завершился `Permission denied` на
init-скрипте; после изменения mount проверка повторена на новой временной БД.
Первый integration run при недоступной БД был FAIL и не засчитывался как успех.
Временные контейнеры, их данные и credentials после проверки удалены.
