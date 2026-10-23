import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { ProfileSettings } from "@/features/settings/profile-settings";
import { SettingsShell } from "@/features/settings/settings-shell";

export default function EditProfilePage() {
  return (
    <HomeAccess>
      <AppShell>
        <SettingsShell title="Редактировать профиль">
          <ProfileSettings />
        </SettingsShell>
      </AppShell>
    </HomeAccess>
  );
}
