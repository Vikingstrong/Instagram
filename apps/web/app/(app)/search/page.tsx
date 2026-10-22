import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { UserSearch } from "@/features/social/user-search";

export default function SearchPage() {
  return (
    <HomeAccess>
      <AppShell>
        <UserSearch />
      </AppShell>
    </HomeAccess>
  );
}
