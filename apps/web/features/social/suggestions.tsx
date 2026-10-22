"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UserSummary } from "@instagram/contracts";

import { useHomeIdentity } from "@/features/auth/home-access";
import { createSocialClient } from "@/lib/api/social";

import type { FollowState } from "./follow-button";

type Suggestions = {
  items: UserSummary[];
  follow: Record<string, FollowState>;
  setFollow(id: string, state: FollowState): void;
  dismiss(id: string): void;
};

const SuggestionsContext = createContext<Suggestions | null>(null);

// null hides every suggestions block: guest, loading, failure or no accounts.
export function useSuggestions(): Suggestions | null {
  const value = useContext(SuggestionsContext);
  return value && value.items.length > 0 ? value : null;
}

// One random set per page view, shared by the feed carousel and the sidebar
// so a follow in one place shows in the other. HomeAccess remounts the page
// when the account changes, which also drops the previous user's list.
export function SuggestionsProvider({
  limit = 20,
  children,
}: {
  limit?: number;
  children: ReactNode;
}) {
  const viewer = useHomeIdentity();
  const viewerId = viewer?.id;
  const [items, setItems] = useState<UserSummary[]>([]);
  const [follow, setFollowMap] = useState<Record<string, FollowState>>({});
  const loaded = useRef(false);

  useEffect(() => {
    // Identity is briefly null while HomeAccess rechecks a focused tab; keep
    // the list instead of fetching a new random set each time.
    if (!viewerId || loaded.current) return;
    const controller = new AbortController();
    void createSocialClient()
      .suggestions(limit, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        loaded.current = true;
        // A failed request hides the block; suggestions are optional.
        setItems(result.ok ? result.data.items : []);
      });
    return () => controller.abort();
  }, [viewerId, limit]);

  const value: Suggestions | null = viewerId
    ? {
        items,
        follow,
        setFollow: (id, state) =>
          setFollowMap((map) => ({ ...map, [id]: state })),
        dismiss: (id) =>
          setItems((list) => list.filter((user) => user.id !== id)),
      }
    : null;
  return (
    <SuggestionsContext.Provider value={value}>
      {children}
    </SuggestionsContext.Provider>
  );
}
