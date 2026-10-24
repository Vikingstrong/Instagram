# Необязательное восстановление пароля по email

Актуально с 2026-10-24: подтверждение email отменено по решению владельца.
Mailpit больше не входит в проект. Регистрация и login сразу открывают аккаунт;
[инструкция и передача Developer 2](auth-without-verification.md) — источник
текущих правил. EmailVerified остаётся исторической метаданной, без прав доступа.

## Контракт и поведение

GET `/api/v1/auth/capabilities` сообщает passwordRecoveryEnabled. Recovery по
умолчанию выключено, без SMTP ключей приложение запускается. Password/request
возвращает одинаковый 503 для всех адресов; UI не обещает письмо.

При включённом recovery POST `/auth/password/request` с email и Origin/CSRF даёт
одинаковый 202 для существующего и неизвестного адреса. POST `/auth/password/reset`
потребляет fragment-token явно и только один раз, меняет пароль и отзывает все
прежние сессии, токены и realtime-потоки. Новый вход обязателен.
Токен на 30 минут, password — 8–128 Unicode code points. Rate limits и защита
от enumeration сохранены. Регистрация не вызывает mail и не выдаёт токенов.

## MailModule и миграция

Auth владеет транзакцией, MailModule — encrypted durable outbox и доставкой.
Ссылки зашифрованы AES-256-GCM с token id в AAD; в auth_tokens — только хеш.
Worker берёт lease через SKIP LOCKED, повторяет сбои и удаляет payload после
успеха/отмены. Ошибки SMTP/драйвера и секретные ссылки не логируются.
Старые verification jobs при миграции отменяются; worker отправляет только
PASSWORD_RESET. Прошлые миграции, enum и исторические записи не удаляются.

## Конфигурация и запуск

PASSWORD_RECOVERY_ENABLED=true, SMTP_HOST/PORT/FROM и постоянный MAIL_OUTBOX_KEY
включают recovery. SMTP_USER/PASSWORD задаются парой при необходимости; production
использует TLS. Все значения только server-side. Без явного включения worker не
запускается и старые локальные SMTP-переменные не влияют на регистрацию.
Подробнее и команда миграции — в [актуальной инструкции](auth-without-verification.md).

## Frontend и browser harness

EmailForm поддерживает forgot-password и reset-password. Доступность проверяется
через capabilities; hash очищается до потребления токена, Strict Mode и смена
ссылки на странице обрабатываются. SessionPanel не показывает resend/verification.
Почтовые browser-тесты используют изолированный compiled Auth и локальный SMTP
receiver, а product fixtures — обычные неподтверждённые зарегистрированные аккаунты.

## Проверки — 2026-10-22

Прежние отчёты с verification относились к старому поведению. Текущий срез
проверяет регистрацию без SMTP и сохраняет тесты recovery: expiry/replay,
конкуренцию reset/login, шифрование/AAD, lease/retry, отзыв сессий, HTTP/SMTP и web.
FND-08 и реальная доставка выбранным провайдером остаются отдельными проверками.
