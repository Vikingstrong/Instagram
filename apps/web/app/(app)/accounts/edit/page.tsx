import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { ProfileSettings } from "@/features/social/profile-settings";

export default function EditProfilePage() {
  return (
    <HomeAccess>
      <AppShell>
        <ProfileSettings />
      </AppShell>
    </HomeAccess>
  );
}
