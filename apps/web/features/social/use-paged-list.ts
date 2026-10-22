"use client";

import { useEffect, useReducer, useRef } from "react";

import type { ApiFailure, ApiResult } from "@/lib/api/client";

type Page<T> = { items: T[]; nextCursor: string | null };
export type PageLoader<T> = (
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<ApiResult<Page<T>>>;

type State<T> = {
  items: T[];
  cursor: string | null;
  loading: boolean;
  failure?: ApiFailure;
};
type Action<T> =
  | { type: "start" }
  | { type: "page"; append: boolean; page: Page<T> }
  | { type: "fail"; failure: ApiFailure }
  | { type: "remove"; keep: (item: T) => boolean };

function reduce<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case "start":
      return { ...state, loading: true, failure: undefined };
    case "page":
      return {
        items: action.append
          ? [...state.items, ...action.page.items]
          : action.page.items,
        cursor: action.page.nextCursor,
        loading: false,
      };
    case "fail":
      return { ...state, loading: false, failure: action.failure };
    case "remove":
      return { ...state, items: state.items.filter(action.keep) };
  }
}

// Cursor-paged list: loads the first page whenever `key` changes (nothing
// while it is undefined), appends on more(), and drops stale responses.
export function usePagedList<T>(load: PageLoader<T>, key: string | undefined) {
  const [state, dispatch] = useReducer(reduce<T>, {
    items: [],
    cursor: null,
    loading: true,
  });
  const loader = useRef(load);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    loader.current = load;
  });

  function run(after: string | undefined) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void loader.current(after, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      dispatch(
        result.ok
          ? { type: "page", append: after !== undefined, page: result.data }
          : { type: "fail", failure: result.failure },
      );
    });
  }

  useEffect(() => {
    if (key === undefined) return;
    run(undefined);
    return () => request.current?.abort();
    // run reads the latest loader through a ref; only the key restarts it.
  }, [key]);

  return {
    ...state,
    more() {
      if (!state.cursor) return;
      dispatch({ type: "start" });
      run(state.cursor);
    },
    retry() {
      dispatch({ type: "start" });
      run(state.items.length > 0 ? (state.cursor ?? undefined) : undefined);
    },
    remove(keep: (item: T) => boolean) {
      dispatch({ type: "remove", keep });
    },
  };
}
