"use client";

import type { ApiFailure } from "@/lib/api/client";
import { describeFailure } from "@/lib/api/messages";

type ApiErrorNoticeProps = {
  failure: ApiFailure;
  onRetry?: () => void;
};

// Callers choose when to render a failed request; this component never fetches,
// switches to fixtures, or displays raw backend messages/internal details.
export function ApiErrorNotice({ failure, onRetry }: ApiErrorNoticeProps) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
      <p>{describeFailure(failure)}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 cursor-pointer font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Попробовать снова
        </button>
      )}
    </div>
  );
}
