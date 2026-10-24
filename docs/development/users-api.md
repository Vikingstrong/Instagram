# Users API — профиль, подписки, рекомендации, поиск (этап 3)

Backend этапа 3 готов: профиль, подписки и запросы, списки, рекомендации и
поиск. Frontend этапа — следующий срез. Решения приняты Developer 2 соло
2026-10-22, пока Developer 1 недоступен; требуют review в PR.

## Решения по продуктовым блокерам

| ID | Решение |
| --- | --- |
| P-04 | Профили, списки, рекомендации и поиск доступны только действующей сессии; гостевого чтения нет |
| P-05 | Списки подписчиков/подписок приватного профиля видят владелец и одобренные подписчики (иначе `403 PROFILE_PRIVATE`); счётчики видны всем |
| P-06 | Публичный → приватный: подписчики сохраняются. Приватный → публичный: все ожидающие запросы одобряются в той же транзакции |
| P-07 | Блокировки не входят в этап 3 |
| P-09 | `displayName` ≤ 30, `bio` ≤ 150 code points (bio допускает перевод строки, управляющие символы запрещены); поисковый запрос 1–160 после trim; страница 20, максимум 50; рекомендации 5, максимум 20 |

Отклонённый запрос удаляется: пользователь может запросить подписку снова.

## База

Миграция `20261022130000_users_profile_follows`:

- `auth_users`: `displayName VARCHAR(30)`, `bio VARCHAR(150)` (по умолчанию
  пустые), `isPrivate BOOLEAN` (по умолчанию `false`).
- `follows`: PK `(followerId, followeeId)`, `status` `PENDING | ACCEPTED`,
  `acceptedAt`. CHECK запрещает подписку на себя и требует
  `acceptedAt` ровно для `ACCEPTED`. Каскадное удаление с пользователем.
  Индексы `(followeeId, status)` и `(followerId, status)`.

## Общие правила

Контракты — `packages/contracts/src/users.ts` и `social.ts`. Все маршруты
требуют действующую сессию (`401 AUTHENTICATION_REQUIRED` для гостя), отвечают `Cache-Control: no-store` и
используют общий конверт ошибок Auth. Мутации требуют Origin + CSRF и тело
JSON (`{}` для действий без полей). С 2026-10-24 emailVerified=false не скрывает аккаунт: профили, списки, поиск,
рекомендации и подписки используют обычные правила приватности без verification.

Карточка пользователя (`UserSummary`): id, username, displayName,
`avatarUrl: null` (аватар — этап 4), isPrivate. Постов в ответах нет.

Списки постраничные: `?limit=1..50&cursor=<nextCursor>`; `nextCursor: null`
означает конец. Курсор непрозрачный; неверный курсор, лимит или лишний
параметр — `400 INVALID_REQUEST`.

## Запросы

| Метод | Путь | Ответ / ошибки |
| --- | --- | --- |
| GET | `/api/v1/users/{username}` | `{ profile }`: карточка + bio, `counts` (posts пока 0; только одобренные подписки), `relationship` `self/none/requested/following`. Username без учёта регистра. `404 USER_NOT_FOUND`, `400` для некорректного имени |
| GET | `/api/v1/me/profile` | `{ profile }`: id, username, displayName, bio, isPrivate |
| PATCH | `/api/v1/me/profile` | Частичное изменение (минимум одно поле). `409 USERNAME_TAKEN` без учёта регистра |
| POST | `/api/v1/users/{id}/follow` | `{ relationship }`: `following` (публичный) или `requested` (приватный). Идемпотентно. `400 CANNOT_FOLLOW_SELF`, `404 USER_NOT_FOUND` |
| DELETE | `/api/v1/users/{id}/follow` | Отписка или отмена запроса → `{ relationship: "none" }`. Идемпотентно |
| GET | `/api/v1/users/{id}/followers` | `{ items: UserSummary[], nextCursor }`, новые сверху. P-05 |
| GET | `/api/v1/users/{id}/following` | То же для подписок |
| GET | `/api/v1/me/follow-requests` | Входящие ожидающие запросы: `{ items: [{ user, requestedAt }], nextCursor }` |
| POST | `/api/v1/me/follow-requests/{id}/accept` | `{ status: "accepted" }`. Уже обработанный/отменённый — `404 FOLLOW_REQUEST_NOT_FOUND` |
| POST | `/api/v1/me/follow-requests/{id}/decline` | `{ status: "declined" }`, запрос удаляется. Повтор — 404 |
| DELETE | `/api/v1/me/followers/{id}` | `{ status: "removed" }`. Идемпотентно; доступ к приватному контенту прекращается |
| GET | `/api/v1/me/suggestions?limit=5` | `{ items: UserSummary[] }`: случайные аккаунты, кроме себя и тех, на кого уже подписан или отправил запрос. Пустой список → UI скрывает блок рекомендаций |
| GET | `/api/v1/search/users?q=` | `{ items, nextCursor }`: подстрока в username или displayName без учёта регистра, по алфавиту username. `%`, `_` и `\` ищутся буквально |

Поиск и рекомендации вынесены из `/users/...`: иначе `search` или
`suggestions` совпали бы с маршрутом профиля по username.

## Гонки и согласованность

- Подписка читает `isPrivate` цели под `FOR SHARE`, смена приватности держит
  `FOR UPDATE`: запрос не может остаться ожидающим на публичном профиле.
- Повторные и параллельные подписки создают одну строку
  (`ON CONFLICT DO NOTHING`).
- Принятие и отклонение — условные переходы из `PENDING`: при гонке ровно одно
  действие успешно, остальные получают 404.
- Поиск без индекса подстрок (последовательное сканирование); для MVP
  достаточно, индекс `pg_trgm` — отдельное решение по инфраструктуре.

## Проверки

- `packages/contracts/test/users.test.mjs`, `social.test.mjs` — поля, лимиты,
  курсоры, ошибки.
- `apps/api/test/users.integration-spec.ts` — профиль, права, CSRF,
  переименование, переходы приватности, ограничения `follows`.
- `apps/api/test/social.integration-spec.ts` — подписка публичная/приватная,
  идемпотентность, self/404/400/CSRF, принятие/отклонение/отмена, параллельные
  подписки и решения, гонка с переходом в публичный режим, удаление подписчика,
  P-05 и пагинация списков, рекомендации, поиск (регистр, wildcards, страницы,
  лимит 160).
