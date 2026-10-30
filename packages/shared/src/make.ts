import type { Team } from './roles'

/** What each team can make, in the order shown on Home. Keys map to `make.<id>` strings. */
export const MAKE_OPTIONS: Readonly<Record<Team, readonly string[]>> = {
  social: ['feed_post', 'carousel', 'story', 'reel_cover', 'motion_poster', 'ideas_week', 'ideas_video'],
  merch: ['theme', 'moodboard', 'illustration', 'product_visual'],
}
