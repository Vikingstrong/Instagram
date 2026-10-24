# Локальное окружение

Актуально с 2026-10-24: для регистрации, входа и продуктовых функций нужна
PostgreSQL; почтовый контейнер удалён. Node и pnpm закреплены в `.nvmrc` и
`package.json`. SMTP настраивается отдельно только для восстановления пароля.

## Подготовка и запуск

1. Установить версии Node/pnpm проекта и Docker Compose либо нативную PostgreSQL
   по [инструкции базы](database.md).
2. Если `.env` ещё нет, скопировать `.env.example` в корень, заменить DB-пароли и
   URL. Существующий файл и секреты не перезаписывать.
3. Запустить БД и применить dev/test историю:

```bash
docker compose config --quiet
docker compose up -d --wait postgres
pnpm install --frozen-lockfile
pnpm --filter @instagram/api db:migrate:deploy
pnpm --filter @instagram/api db:migrate:test
pnpm dev
```

`config --quiet` не печатает подставленные пароли. Согласованный browser origin —
`http://localhost:3000`, API — порт 4000; не смешивать browser localhost и 127.0.0.1.
Не останавливать чужие процессы и не удалять чужие volumes для освобождения порта.
При нативной БД использовать отдельные dev/test роли и URL, как в database.md.

## Почта и регистрация

Регистрация сразу открывает аккаунт. В `.env.example` восстановление выключено:
`PASSWORD_RECOVERY_ENABLED=false`. Старые SMTP-переменные без явного включения
не активируют доставку. Нет обязательных портов почтового UI/SMTP, контейнера или
ручного подтверждения аккаунтов. Поле emailVerified — исторические данные.

Для реального восстановления включить PASSWORD_RECOVERY_ENABLED=true и задать
SMTP_HOST/PORT/FROM, постоянный MAIL_OUTBOX_KEY и при необходимости SMTP_USER /
SMTP_PASSWORD. Production требует TLS. Секреты — только server-side, без Git и
NEXT_PUBLIC. Подробнее: [Auth без verification](auth-without-verification.md).
Тесты SMTP используют собственный loopback receiver на случайном порту и не
зависят от установленного почтового сервиса.

## Остановка и данные

```bash
docker compose stop postgres
```

Не использовать `down -v` для общей базы. FND-08 (проверка реальных ПК) остаётся
отдельной приёмкой, облачные тесты её не заменяют.

## Историческая проверка прежнего окружения

Ниже сохранён отчёт 2026-10-21 о старой конфигурации. Упомянутый почтовый сервис
с 2026-10-24 удалён и не является требованием запуска или текущего чеклиста.

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
