// Keep route segments in the render tree. The home page owns its session gate
// and shell, so Next can validate the page before the client checks its cookie.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return children;
}
