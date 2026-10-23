import { Injectable } from '@nestjs/common';

// Either one session (by token hash) or every session of a user.
export type SessionRevocation = { tokenHash: string } | { userId: string };
type Listener = (revocation: SessionRevocation) => void;

// In-process signal that sessions were revoked (logout, password reset), so
// long-lived streams can close at once instead of waiting for their next
// session check. One API process (architecture §5): no broker needed.
@Injectable()
export class SessionRevocations {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(revocation: SessionRevocation): void {
    for (const listener of this.listeners) listener(revocation);
  }
}
