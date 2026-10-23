"use client";

import { useState } from "react";

import { mockPosts } from "@/components/home/mock-data";
import { PostCard } from "@/components/home/post-card";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";

import { Feed } from "./feed";

// Signed-in users get the real feed; an explicit guest keeps the design-only
// preview whose actions ask to sign in. A brief session recheck (identity is
// null meanwhile) keeps the feed mounted, so scroll and loaded pages survive.
export function HomeFeed() {
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const [shownId, setShownId] = useState(viewer?.id);
  if (viewer && viewer.id !== shownId) setShownId(viewer.id);

  if (shownId && (viewer || checking)) return <Feed key={shownId} viewerId={shownId} />;
  return mockPosts.map((post) => <PostCard key={post.id} post={post} />);
}
