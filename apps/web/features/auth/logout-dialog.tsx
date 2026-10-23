"use client";

import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui-ig/confirm-dialog";
import { DefaultAvatar } from "@/components/ui-ig/avatar";
import { createAuthClient } from "@/lib/api/auth";
import { describeFailure } from "@/lib/api/messages";
import { replaceLocation } from "@/lib/navigation";

// Asks before signing out. Only a successful logout leaves the page; a failure
// stays in the dialog and never claims that the session ended.
export function LogoutDialog({
  username,
  onClose,
}: {
  username?: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const result = await createAuthClient().logout();
    if (result.ok) {
      replaceLocation("/auth/login");
      return;
    }
    pending.current = false;
    setBusy(false);
    setError(describeFailure(result.failure));
  }

  return (
    <ConfirmDialog
      media={<DefaultAvatar size={72} />}
      title="Выйти из аккаунта?"
      description={
        username
          ? `Вы выйдете из аккаунта @${username} на этом устройстве.`
          : "Вы выйдете из аккаунта на этом устройстве."
      }
      confirmLabel="Выйти"
      busy={busy}
      error={error}
      onConfirm={() => void logout()}
      onCancel={onClose}
    />
  );
}
