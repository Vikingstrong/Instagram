import type { ApiFailure } from "./client";

// User-facing text for a failure. UI decides by `code`, never by the API's
// `message`, so wording stays localized here. A new contract error code
// fails the exhaustive check below until it gets its own text.
export function describeFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case "api":
      switch (failure.error.code) {
        case "COINS_INSUFFICIENT_BALANCE": return "Недостаточно монет для этого подарка.";
        case "COINS_OPERATION_CONFLICT": return "Этот запрос уже использован для другого подарка. Обновите страницу.";
        case "COINS_BALANCE_LIMIT": return "Достигнут предел баланса монет.";
        case "INVALID_OR_EXPIRED_TOKEN":
          return "Ссылка недействительна или срок её действия истёк. Запросите новое письмо.";
        case "SERVICE_UNAVAILABLE":
          return "Сервис временно недоступен. Попробуйте позже.";
        case "INVALID_AUDIO": return "Не удалось прочитать аудио. Запишите сообщение заново.";
        case "AUDIO_TOO_LONG": return "Голосовое сообщение длиннее трёх минут.";
        case "AUDIO_TOO_LARGE": return "Голосовое сообщение больше 10 МБ.";
        case "INVALID_IMAGE":
          return "Файл повреждён или это не JPEG, PNG или WebP.";
        case "IMAGE_TOO_LARGE":
          return "Фото больше 10 МБ. Выберите файл поменьше.";
        case "INVALID_VIDEO":
          return "Видео повреждено или это не MP4, MOV или WebM.";
        case "VIDEO_TOO_LARGE":
          return "Видео больше 100 МБ. Выберите файл поменьше.";
        case "VIDEO_TOO_LONG":
          return "Видео длиннее 90 секунд. Обрежьте его и попробуйте снова.";
        case "STORY_NOT_FOUND":
          return "История недоступна или срок её действия истёк.";
        case "POST_NOT_FOUND":
          return "Публикация недоступна или удалена.";
        case "MEDIA_NOT_FOUND":
          return "Изображение недоступно.";
        case "COMMENT_NOT_FOUND":
          return "Комментарий уже удалён.";
        case "CANNOT_DELETE_COMMENT":
          return "Этот комментарий нельзя удалить.";
        case "CALL_NOT_FOUND": return "Звонок недоступен или уже завершён.";
        case "CALL_BUSY": return "Вы или собеседник уже участвуете в звонке.";
        case "CALL_STATE_CONFLICT": return "Звонок уже обработан на другом устройстве. Начните новый звонок.";
        case "CALLS_UNAVAILABLE": return "Звонки пока не настроены на сервере.";
        case "LIVE_NOT_FOUND": return "Эфир недоступен или уже удалён.";
        case "LIVE_BUSY": return "У вас уже идёт эфир. Завершите его, чтобы начать новый.";
        case "LIVE_FULL": return "В эфире уже максимум зрителей. Попробуйте чуть позже.";
        case "LIVE_ENDED": return "Эфир уже завершён.";
        case "LIVE_STATE_CONFLICT": return "Эфир открыт на другом устройстве или в другой вкладке.";
        case "LIVES_UNAVAILABLE": return "Прямые эфиры пока не настроены на сервере.";
        case "LIVE_BANNED": return "Вас забанили на трансляции.";
        case "LIVE_MUTED": return "Вы не можете писать и дарить подарки в этом эфире.";
        case "LIVE_MODERATION_FORBIDDEN": return "Недостаточно прав для модерации этого пользователя.";
        case "CONVERSATION_NOT_FOUND":
          return "Диалог не найден.";
        case "CANNOT_MESSAGE_SELF":
          return "Нельзя написать самому себе.";
        case "MESSAGE_ID_CONFLICT":
          return "Сообщение не отправлено. Напишите его ещё раз.";
        case "INVALID_REQUEST":
          return "Проверьте введённые данные.";
        case "INVALID_CREDENTIALS":
          return "Неверный email или пароль.";
        case "AUTHENTICATION_REQUIRED":
          return "Войдите в аккаунт.";
        case "REQUEST_FORBIDDEN":
          return "Обновите страницу и повторите запрос.";
        case "CANNOT_FOLLOW_SELF":
          return "Нельзя подписаться на себя.";
        case "PROFILE_PRIVATE":
          return "Это закрытый аккаунт.";
        case "FOLLOW_REQUEST_NOT_FOUND":
          return "Запрос на подписку уже обработан.";
        case "USER_NOT_FOUND":
          return "Пользователь не найден.";
        case "USERNAME_TAKEN":
          return "Это имя пользователя уже занято.";
        case "ACCOUNT_UNAVAILABLE":
          return "Не удалось зарегистрировать аккаунт с указанными данными.";
        case "TOO_MANY_REQUESTS":
          return "Слишком много запросов. Попробуйте позже.";
        case "INTERNAL_ERROR":
          return "Что-то пошло не так. Попробуйте ещё раз.";
        default: {
          const unhandled: never = failure.error;
          return unhandled;
        }
      }
    case "network":
      return "Нет соединения с сервером. Проверьте интернет.";
    case "aborted":
      return "Запрос отменён.";
    case "invalid_response":
      return "Что-то пошло не так. Попробуйте ещё раз.";
  }
}
