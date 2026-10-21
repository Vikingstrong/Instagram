# FND-02 — review контракта со стороны frontend

**Ревьюер:** Developer 2 (frontend). **Дата:** 2026-10-21.
**Предмет:** `@instagram/contracts` из PR #2 и web entry `apps/web/lib/api/`.
**Основание:** [foundation-contracts.md](foundation-contracts.md), раздел «Передача Claude».

## Решение

**Контракт принят frontend** в текущем виде: путь `GET /api/v1/readiness`,
статусы 200/503, `{"status":"ready"}` и конверт ошибки
`{ error: { code, message, requestId } }`. Формат ошибки подходит для UI.

С этим подтверждением FND-05/FND-06 можно готовить на фикстурах.
Пункты 2–4 ниже не блокируют FND-02, но ответы на них нужны до соответствующих задач.

## 1. Исправлено: `"use client"` ломал Server Components

**Где:** `apps/web/lib/api/contracts.ts`, `apps/web/lib/api/contracts.fixture.ts`.

`"use client"` превращает экспорты модуля в client references. Server Component
получал не Zod-схему, а ссылку без методов. Проверка временной серверной страницей:

```
TypeError: c.ReadinessResponseSchema.safeParse is not a function
```

Это противоречит AGENTS.md: web выполняет операции через API в том числе из
Server Components, поэтому будущий REST-клиент должен работать на сервере.
TypeScript такую ошибку не видит, а `next build` проходил, потому что модули
пока никто не импортирует.

**Сделано (зона web):** директива удалена из обоих файлов, в `contracts.ts`
добавлен комментарий-предупреждение. После исправления та же серверная
страница собирается, схема и фикстура вызываются. Контракт в
`packages/contracts` не менялся.

## 2. Вопрос к FND-04: все ли ошибки API приходят в этом конверте?

REST-клиенту нужен один путь обработки ошибок. Встроенные ошибки NestJS
(404, 400, 500) по умолчанию имеют другой формат: `{ statusCode, message, error }`.

**Просьба:** подтвердить, что в FND-04 будет глобальный exception filter,
который приводит любую ошибку API к `{ error: { code, message, requestId } }`
без внутренних деталей, и добавить для этого коды в контракт при согласовании.

Ответы вне контракта (HTML от proxy при 502, сетевой сбой, невалидный JSON)
frontend в любом случае обрабатывает как неизвестную ошибку, без падения UI.

## 3. Предложение на будущее: расширение кодов ошибок

Сейчас `code` и `message` заданы через `z.literal`. Для одного кода это
корректно. Когда появятся auth-коды (этап 2), предлагаем:

- общий конверт с `code: z.enum([...])`;
- связь кода и безопасного текста через discriminated union по `code`;
- UI ветвится только по `code` и локализует текст сам, как уже указано в
  контракте.

Сейчас изменений не требуется, нужно только согласие с направлением.

## 4. Подтвердить: строгие схемы на клиенте

`z.strictObject` отклоняет лишние поля и при разборе ответа в браузере. Значит,
любое добавление поля в ответ API становится breaking change для web. В
монорепо с общим деплоем это допустимо и совпадает с правилом AGENTS.md
«схемы, producers и consumers меняются вместе». **Просьба:** явно подтвердить,
что принимаем такое правило.

## 5. Мелкое

- **Watch-режим.** У `@instagram/contracts` нет `dev`-скрипта. Изменение схемы во
  время `pnpm dev` требует ручного `pnpm --filter @instagram/contracts build` и
  перезапуска. Предложение: добавить `"dev": "tsc -p tsconfig.json --watch"`.
  Нужно согласование, так как это меняет scripts пакета.
- **Кеш.** Readiness отдаёт `Cache-Control: no-store`, а в web включён
  `cacheComponents`. Учтём на стороне web: запрос readiness делается без кеша.

## Проверки frontend

| Проверка | Результат |
| --- | --- |
| Временная Server Component страница: импорт из `@/lib/api/contracts` до исправления | FAIL: `safeParse is not a function` |
| Та же страница, импорт напрямую из `@instagram/contracts` | PASS |
| Та же страница после удаления `"use client"` (схема + фикстура) | PASS |
| `turbo run check-types lint build --filter=@instagram/web...` (contracts + web) | PASS, 6/6 задач |
| Штатный `next build` на **Turbopack** | PASS на машине Developer 2. Закрывает пункт отчёта FND-02, где у backend он падал с `EPERM` из-за среды |
| Сборка и тесты API | NOT RUN frontend-ревьюером |
| Browser smoke, реальный readiness | NOT RUN: маршрута нет до FND-04, browser runner не выбран (FND-01) |

Временная страница удалена; в репозитории остались только изменения из пункта 1.
