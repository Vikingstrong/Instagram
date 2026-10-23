import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { DirectView } from "@/features/direct/direct-view";

// The conversation id is read on the client: history needs the session.
export default function DirectThreadPage() {
  return (
    <HomeAccess>
      <AppShell>
        <DirectView />
      </AppShell>
    </HomeAccess>
  );
}
