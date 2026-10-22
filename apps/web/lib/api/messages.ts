import type { ApiFailure } from "./client";

// User-facing text for a failure. UI decides by `code`, never by the API's
// `message`, so wording stays localized here. A new contract error code
// fails the exhaustive check below until it gets its own text.
export function describeFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case "api":
      switch (failure.error.code) {
        case "INVALID_OR_EXPIRED_TOKEN":
          return "Ссылка недействительна или срок её действия истёк. Запросите новое письмо.";
        case "SERVICE_UNAVAILABLE":
          return "Сервис временно недоступен. Попробуйте позже.";
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
