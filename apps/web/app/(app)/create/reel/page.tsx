import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { CreatePost } from "@/features/posts/create-post";

export default function CreateReelPage() {
  return (
    <HomeAccess>
      <AppShell>
        <CreatePost mode="reel" />
      </AppShell>
    </HomeAccess>
  );
}
