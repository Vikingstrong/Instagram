import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { Reels } from "@/features/posts/reels";

export default function ReelsPage() {
  return (
    <HomeAccess>
      <AppShell>
        <Reels />
      </AppShell>
    </HomeAccess>
  );
}
