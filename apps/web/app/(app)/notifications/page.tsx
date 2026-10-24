import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { FollowRequests } from "@/features/social/follow-requests";
import { ActivityNotifications } from "@/features/social/activity-notifications";

export default function NotificationsPage() {
  return (
    <HomeAccess>
      <AppShell>
        <div className="mx-auto flex w-full max-w-150 flex-col gap-8 px-4 py-8">
          <h1 className="text-2xl font-bold">Уведомления</h1>
          <ActivityNotifications />
          <FollowRequests />
        </div>
      </AppShell>
    </HomeAccess>
  );
}
