// Design-only placeholder posts. Not an API contract: replaced by real data
// from the API in stages 4 (media) and 5 (feed).

export type MockUser = {
  username: string;
  displayName: string;
  verified?: boolean;
};

export type MockPost = {
  id: string;
  author: MockUser;
  postedAgo: string;
  audio: string;
  likes: string;
  caption: string;
  comments: number;
  mediaClassName: string;
};

export const mockPosts: MockPost[] = [
  {
    id: "p1",
    author: { username: "snowy.trails", displayName: "Snowy Trails" },
    postedAgo: "9 ч.",
    audio: "Оригинальный звук • Магия момента",
    likes: "1 284",
    caption: "Первый снег в горах ❄️",
    comments: 23,
    mediaClassName:
      "bg-[linear-gradient(180deg,#4f545b_0%,#6b7076_38%,#59605e_58%,#2f3a35_74%,#c9ced2_100%)]",
  },
  {
    id: "p2",
    author: { username: "city.evenings", displayName: "City Evenings", verified: true },
    postedAgo: "1 д.",
    audio: "city.evenings • Оригинальный звук",
    likes: "3 906",
    caption: "Огни вечернего города",
    comments: 118,
    mediaClassName:
      "bg-[linear-gradient(160deg,#1b1f3b_0%,#3a2d5c_40%,#a8466b_75%,#f2a65a_100%)]",
  },
];
