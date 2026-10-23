"use client";
import { useEffect, useState } from "react";
import { Phone, Video, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Call } from "@instagram/contracts";
import { createCallsClient } from "@/lib/api/calls";
import { usePagedList } from "@/features/social/use-paged-list";
import { ApiErrorNotice } from "@/components/api/api-error-notice";
const labels = {
  RINGING: "Вызов",
  ACTIVE: "Идёт звонок",
  ENDED: "Завершён",
  DECLINED: "Отклонён",
  MISSED: "Пропущен",
  FAILED: "Соединение прервано",
};
export function CallHistory({
  conversationId,
  viewerId,
}: {
  conversationId: string;
  viewerId: string;
}) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("instagram-call-history", refresh);
    return () => window.removeEventListener("instagram-call-history", refresh);
  }, []);
  return (
    <section
      aria-label="Звонки в диалоге"
      className="border-b bg-secondary/20 px-4 py-2"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Phone size={14} />
        {open ? "Скрыть историю звонков" : "История звонков"}
      </button>
      {open && (
        <History
          key={`${conversationId}:${revision}`}
          conversationId={conversationId}
          viewerId={viewerId}
        />
      )}
    </section>
  );
}
function History({
  conversationId,
  viewerId,
}: {
  conversationId: string;
  viewerId: string;
}) {
  const list = usePagedList<Call>(
    (cursor, signal) =>
      createCallsClient().history(conversationId, cursor, signal),
    conversationId,
  );
  return (
    <div className="max-h-52 overflow-y-auto py-2">
      {list.failure && (
        <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
      )}
      {list.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Загрузка звонков…
        </p>
      )}
      {!list.loading && !list.failure && !list.items.length && (
        <p className="text-xs text-muted-foreground">Звонков пока нет.</p>
      )}
      <ul className="space-y-2">
        {list.items.map((call) => (
          <li
            key={call.id}
            className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2 text-xs"
          >
            <span className="rounded-full bg-secondary p-2">
              {call.kind === "VIDEO" ? (
                <Video size={16} />
              ) : (
                <Phone size={16} />
              )}
            </span>
            <div className="flex-1">
              <p className="font-medium">
                {call.kind === "VIDEO" ? "Видеозвонок" : "Аудиозвонок"} ·{" "}
                {labels[call.status]}
              </p>
              <time className="text-muted-foreground" dateTime={call.createdAt}>
                {new Date(call.createdAt).toLocaleString("ru-RU")}
              </time>
            </div>
            {call.callerId === viewerId ? (
              <ArrowUpRight size={16} aria-label="Исходящий" />
            ) : (
              <ArrowDownLeft size={16} aria-label="Входящий" />
            )}
          </li>
        ))}
      </ul>
      {list.cursor && (
        <button
          type="button"
          disabled={list.loading}
          onClick={list.more}
          className="mt-2 text-xs text-ig-link"
        >
          Предыдущие звонки
        </button>
      )}
    </div>
  );
}
