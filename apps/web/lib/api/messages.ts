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
        case "EMAIL_VERIFICATION_REQUIRED":
          return "Подтвердите email для продолжения.";
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
