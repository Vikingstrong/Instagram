import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { LiveViewerRoute } from "@/features/live/live-viewer";

export default function LiveViewerPage() {
  return (
    <HomeAccess>
      <AppShell>
        <LiveViewerRoute />
      </AppShell>
    </HomeAccess>
  );
}
