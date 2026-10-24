import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { LiveHost } from "@/features/live/live-host";

// Going live needs the session and the browser's camera: client only.
export default function LiveHostPage() {
  return (
    <HomeAccess>
      <AppShell>
        <LiveHost />
      </AppShell>
    </HomeAccess>
  );
}
