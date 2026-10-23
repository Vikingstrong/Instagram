import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { PostView } from "@/features/posts/post-view";

// The post id is read on the client: posts need the viewer's session.
export default function PostPage() {
  return (
    <HomeAccess>
      <AppShell>
        <PostView />
      </AppShell>
    </HomeAccess>
  );
}
