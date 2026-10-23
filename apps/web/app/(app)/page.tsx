import { StoryTray } from "@/features/stories/story-tray";
import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { SuggestionsProvider } from "@/features/social/suggestions";
import { HomeFeed } from "@/features/posts/home-feed";
import { RightSidebar } from "@/components/home/right-sidebar";
import { SuggestionsCarousel } from "@/components/home/suggestions-carousel";

// Home layout mirrors the desktop app: a 630px feed column with a 470px feed,
// plus the right column on wide screens. Suggestions and the feed come from
// the API; guests see a design-only preview (see HomeFeed).
export default function Home() {
  return (
    <HomeAccess><AppShell><SuggestionsProvider><div className="flex justify-center">
      <div className="flex w-full max-w-157.5 justify-center">
        <div className="flex w-full max-w-117.5 flex-col gap-6 py-4 md:py-6">
          <h1 className="sr-only">Главная</h1>
          <StoryTray />
          <SuggestionsCarousel />
          <HomeFeed />
        </div>
      </div>

      <RightSidebar />
    </div></SuggestionsProvider></AppShell></HomeAccess>
  );
}
