import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { PrivacySettings } from "@/features/settings/privacy-settings";
import { SettingsShell } from "@/features/settings/settings-shell";

export default function PrivacyPage() {
  return (
    <HomeAccess>
      <AppShell>
        <SettingsShell title="Конфиденциальность">
          <PrivacySettings />
        </SettingsShell>
      </AppShell>
    </HomeAccess>
  );
}
