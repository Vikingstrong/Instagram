import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { ProfileView } from "@/features/social/profile-view";

// The username is read on the client: profiles need the viewer's session.
export default function ProfilePage() {
  return (
    <HomeAccess>
      <AppShell>
        <ProfileView />
      </AppShell>
    </HomeAccess>
  );
}
