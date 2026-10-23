import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { DirectView } from "@/features/direct/direct-view";

export default function DirectPage() {
  return (
    <HomeAccess>
      <AppShell>
        <DirectView />
      </AppShell>
    </HomeAccess>
  );
}
