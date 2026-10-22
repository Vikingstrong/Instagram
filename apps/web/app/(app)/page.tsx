import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import {
  mockPosts,
  mockSuggestedCards,
  mockSuggestedList,
} from "@/components/home/mock-data";
import { PostCard } from "@/components/home/post-card";
import { RightSidebar } from "@/components/home/right-sidebar";
import { SuggestionsCarousel } from "@/components/home/suggestions-carousel";

// Home layout mirrors the desktop app: a 630px feed column with a 470px feed,
// plus the right column on wide screens. Data is design-only (see mock-data).
export default function Home() {
  return (
    <HomeAccess><AppShell><div className="flex justify-center">
      <div className="flex w-full max-w-157.5 justify-center">
        <div className="flex w-full max-w-117.5 flex-col gap-6 py-4 md:py-6">
          <h1 className="sr-only">Главная</h1>
          <SuggestionsCarousel users={mockSuggestedCards} />
          {mockPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </div>

      <RightSidebar
        suggestions={mockSuggestedList}
      />
    </div></AppShell></HomeAccess>
  );
}
