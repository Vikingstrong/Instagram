import { HomeAccess } from "@/features/auth/home-access";
import { StoryViewer } from "@/features/stories/story-viewer";
export default function Page() { return <HomeAccess><StoryViewer byUser /></HomeAccess>; }
