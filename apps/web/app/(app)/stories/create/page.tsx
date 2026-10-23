import { HomeAccess } from "@/features/auth/home-access";
import { AppShell } from "@/components/shell/app-shell";
import { CreateStory } from "@/features/stories/create-story";
export default function Page() { return <HomeAccess><AppShell><CreateStory /></AppShell></HomeAccess>; }
