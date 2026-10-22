// Full document navigation that replaces the current history entry. Used after
// auth changes so the previous account's React/router state is dropped.
// A separate module so tests can observe it (jsdom cannot navigate).
export function replaceLocation(path: string): void {
  window.location.replace(path);
}
