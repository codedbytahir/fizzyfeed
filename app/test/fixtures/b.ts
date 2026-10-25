/**
 * Fixture B — 200 posts across 3 channels, lopsided 160/30/10 (→ 80/15/5%),
 * spread one per day across 2025 with repeating keyword-rich texts so
 * topTopics has honest recurring terms. Shares the deterministic row()
 * builder from fixture A (single builder source inside 4-c's owned files).
 */
import { row, JAN1_2025 } from "./a";
import type { PostRow } from "../../src/shared/schema";

const PHRASES = [
  "big launch day energy with the whole team",
  "morning coffee then straight into the release review",
  "shipping the release notes before lunch",
  "coffee run and a quick design review",
  "the launch retrospective with the design team",
  "late night release train watch",
];

export const fixB: PostRow[] = Array.from({ length: 200 }, (_, k) => {
  const plan =
    k < 160
      ? { channel_id: "chan-x", channel_service: "twitter" }
      : k < 190
        ? { channel_id: "chan-y", channel_service: "instagram" }
        : { channel_id: "chan-z", channel_service: "linkedin" };
  return row({
    ...plan,
    created_at: JAN1_2025 + k * 86400 + 12 * 3600, // one post per day, noon UTC
    text: PHRASES[k % PHRASES.length],
  });
});
