import type { ApiFailure } from "./client";

// User-facing text for a failure. UI decides by `code`, never by the API's
// `message`, so wording stays localized here. A new contract error code
// fails the exhaustive check below until it gets its own text.
export function describeFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case "api":
      switch (failure.error.code) {
        case "SERVICE_UNAVAILABLE":
          return "Сервис временно недоступен. Попробуйте позже.";
        default: {
          const unhandled: never = failure.error.code;
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
