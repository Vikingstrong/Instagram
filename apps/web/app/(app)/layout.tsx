import { AppShell } from "@/components/shell/app-shell";

// Route group for pages inside the main app frame. Future auth pages
// (login, signup) live outside this group and render without navigation.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
