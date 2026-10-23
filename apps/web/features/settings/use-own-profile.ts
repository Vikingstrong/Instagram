"use client";

import { useEffect, useState } from "react";
import type { OwnProfile } from "@instagram/contracts";

import { useHomeIdentity } from "@/features/auth/home-access";
import type { ApiFailure } from "@/lib/api/client";
import { createSocialClient } from "@/lib/api/social";

export type OwnProfileLoad =
  | { state: "loading" }
  | { state: "error"; failure: ApiFailure }
  | { state: "ready"; profile: OwnProfile };

// The signed-in account's editable profile, reloaded per account.
export function useOwnProfile() {
  const viewerId = useHomeIdentity()?.id;
  const [load, setLoad] = useState<OwnProfileLoad>({ state: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void createSocialClient()
      .ownProfile(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoad(
          result.ok
            ? { state: "ready", profile: result.data.profile }
            : { state: "error", failure: result.failure },
        );
      });
    return () => controller.abort();
  }, [viewerId, revision]);

  return {
    load,
    retry: () => setRevision((value) => value + 1),
    saved: (profile: OwnProfile) => setLoad({ state: "ready", profile }),
  };
}
