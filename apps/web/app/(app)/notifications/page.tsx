import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { FollowRequests } from "@/features/social/follow-requests";

// Notifications currently hold incoming follow requests (stage 3).
export default function NotificationsPage() {
  return (
    <HomeAccess>
      <AppShell>
        <FollowRequests />
      </AppShell>
    </HomeAccess>
  );
}
