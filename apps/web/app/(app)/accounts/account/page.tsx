import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { AccountSettings } from "@/features/settings/account-settings";
import { SettingsShell } from "@/features/settings/settings-shell";

export default function AccountPage() {
  return (
    <HomeAccess>
      <AppShell>
        <SettingsShell title="Аккаунт">
          <AccountSettings />
        </SettingsShell>
      </AppShell>
    </HomeAccess>
  );
}
