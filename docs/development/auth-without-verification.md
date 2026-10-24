# Auth без подтверждения email — передача второму разработчику

Решение владельца от 2026-10-24 реализовано в коде для учебного деплоя. Регистрация
по email/username/паролю сразу создаёт сессию и открывает приложение; письмо,
SMTP, почтовый контейнер и ручное подтверждение не нужны.

## Важно для Claude Code / Developer 2

- Использовать **SessionGuard**, экспортируемый AuthModule. Проверка сессии,
  срока, отзыва и credentialVersion сохранена; проверка email удалена.
- **Не использовать emailVerified или emailVerifiedAt для доступа или UI-gating.**
  Это правдивые исторические данные: новый аккаунт возвращает false, старое
  значение сохраняется. Миграция не выставляет всем фиктивное подтверждение.
- Backend-поиск, профили, подписки, media, публикации, Stories, Direct, calls и
  coins доступны по обычным правам аккаунта. Приватность и членство диалога не
  ослаблены. Ранее неподтверждённые аккаунты входят и используются сразу.
- `/auth/register` и `/auth/login` всегда переходят в `/`. `/auth/session` —
  обычный экран аккаунта/выхода; писем, resend и экрана ожидания нет.
- POST `/api/v1/auth/verification/request` и `/verification/confirm` удалены (404).
  Их shared schemas/endpoints и клиентские методы удалены. Старые web-страницы
  verify/request-verification только сообщают об отмене требования, без операций.
- Добавлен GET `/api/v1/auth/capabilities` → `{ passwordRecoveryEnabled: boolean }`.
  Это серверная возможность, без адресов SMTP, секретов или сведений об аккаунтах.
- Ошибка EMAIL_VERIFICATION_REQUIRED удалена из активного контракта. Не восстанавливать
  старый guard или редирект на основании false в AuthUser.

## Необязательное восстановление пароля

По умолчанию **выключено** во всех окружениях, включая production. Даже старые
SMTP-переменные не активируют его без явного флага. Запуск, регистрация, login,
профили и остальные функции не требуют почтовых секретов.

Для включения настроить server-side:

```dotenv
PASSWORD_RECOVERY_ENABLED=true
SMTP_HOST=smtp.example.test
SMTP_PORT=587
SMTP_FROM=noreply@your-domain.example
SMTP_SECURE=false
MAIL_OUTBOX_KEY=REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS
# SMTP_USER=provider-user
# SMTP_PASSWORD=provider-secret
```

Это placeholders. Реальные значения — секреты окружения, без Git/NEXT_PUBLIC.
В production требуется TLS: implicit TLS при SMTP_SECURE=true, STARTTLS иначе.
MAIL_OUTBOX_KEY сохранять при перезапуске, иначе прежние encrypted jobs не прочитать.
Частично настроенный включённый SMTP отклоняется при старте; выключенный игнорирует
старые настройки и не запускает worker. Capabilities отражает настройку, а не
проверку доставки конкретного письма.

При выключенном recovery страница сообщает о недоступности и не предлагает
отправку; password/request отвечает одинаковым 503 известному и неизвестному
email. При включённом — прежний generic 202, encrypted outbox, SMTP retries и
одноразовый 30-минутный токен. Уже выданный действительный reset-link можно
потребить по прежним правилам; новое письмо при выключенном recovery не выдаётся.
Успешная смена пароля отзывает все сессии/токены аккаунта; автоматического входа нет.

## Данные и запуск

Применить additive migration `20261025040000_retire_email_verification` к dev/test,
а при деплое — к production перед новым API. Остановить прежний API/mail worker
перед переключением: миграция отзывает незавершённые EMAIL_VERIFICATION-токены
и отменяет их неотправленные outbox-задания, очищает payload/lease.
Не меняет emailVerifiedAt, пароли, сессии, recovery-токены и продуктовые данные.
Исторический enum/колонки сохранены для совместимости истории БД.

```bash
docker compose up -d --wait postgres
pnpm --filter @instagram/api db:migrate:deploy
pnpm --filter @instagram/api db:migrate:test
pnpm dev
```

Mailpit удалён из Compose, CI и .env.example. Старые MAILPIT_* и локальные
SMTP-параметры можно убрать из собственного .env; секреты БД/Auth не менять.
Новый `.env.example` оставляет PASSWORD_RECOVERY_ENABLED=false.

## Тесты и приёмка

- API: регистрация без enqueue/токенов даже при сбое mail; legacy false допускается,
  гость/чужой аккаунт по-прежнему получают отказ; старые verification endpoints 404.
- Все продуктовые проверки, ранее запрещавшие false, обновлены на обычный доступ;
  проверки приватных профилей, диалогов, файлов и CSRF сохранены.
- Recovery: реальный loopback SMTP receiver `apps/api/test/helpers/test-smtp.ts`
  на случайном порту, без внешнего сервиса; durable encryption, lease, expiry,
  replay, гонка login/reset, отзыв всех сессий и недоступность без конфигурации.
- Browser fixtures теперь `registeredAccount()`, без SQL-подтверждения email.
  Optional SMTP browser-тест использует изолированный compiled Auth и свой SMTP;
  доступ к тестовой очереди ограничен своим userId. Продакшен не имеет test HTTP API.

## Проверено в облаке — исходный PR #40, 2026-10-24

| Проверка | Результат |
| --- | --- |
| Types, lint, production build | PASS; два прежних предупреждения линтера, новых нет |
| Unit / contracts | PASS: 231 |
| PostgreSQL integration | PASS: 142, в том числе 13 recovery/SMTP |
| API E2E / OpenAPI | PASS: 4 |
| Browser desktop/mobile | 44 сценария прошли, 2 штатных viewport skips; мобильный feed прошёл после retry |
| Повтор мобильного и desktop feed без retries | PASS: 4 запуска (repeat-each=2) |
| Fresh migrations / repeat deploy / schema drift | PASS, drift отсутствует |
| Upgrade с действующим legacy токеном/заданием | PASS: отменены только verification; recovery, users/sessions и продуктовые данные сохранены |
| Production launcher без SMTP и outbox key | PASS: readiness, capabilities=false, регистрация, Secure/__Host cookies, защищённый coins wallet |

Первый новый browser-прогон обнаружил неоднозначный locator role=alert
(Next route announcer и сообщение формы). Locator ограничен областью аккаунта;
последующий полный прогон прошёл. В первом полном PostgreSQL-прогоне были
устаревшие verification-ожидания и MIME/lease ожидания test harness; они
исправлены, весь набор повторно прошёл. Внешняя доставка SMTP не проверялась.
Результат GitHub CI последнего commit фиксируется в PR, не подразумевается PASS.

Физические ПК обоих разработчиков, общий `pnpm dev`, реальные браузеры и joint
review по FND-08 остаются отдельной приёмкой. Этот срез не закрывает их автоматически.
Документ — инструкция для второго разработчика; прямое уведомление/запрос review
нужно направить по его подтверждённому контакту, не подставляя случайный GitHub-логин.

## Совместимость с эфирами из PR #39

Изначально владелец выбрал порядок #39 → #40, но при повторном CI обнаружено,
что #40 уже объединён в main (2026-10-24 08:08 UTC). Поэтому исправление
совместимости включено непосредственно в #39, обновлённый от main.
Агент не объединял PR в main.
LiveAlerts обёрнут в Suspense для production prerender динамических страниц.
LivesModule использует SessionGuard; list эфиров и выбор цели модерации больше
не фильтруют по emailVerifiedAt. Приватность, ban/mute, роли модераторов и
транзакции подарков сохранены. Live browser и PostgreSQL tests работают с
зарегистрированными аккаунтами без SQL-подтверждения email.
