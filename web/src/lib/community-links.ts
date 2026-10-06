/**
 * Community links shown in the app: the dashboard footer and the What's new
 * splash (feature #0379). This is the ONE place the Discord invite lives.
 *
 * Release content in data/whats-new/<version>.json refers to these by name
 * (`"url": "discord"`) instead of repeating the URL, so swapping the invite
 * is a one-line change here (permanent invite since 2026-10-06). The design
 * mockup (documentation/designs/whats_new_release_splash_mockup.html) keeps a
 * matching constant at the top of its script; it is a static file and cannot
 * import this.
 */
export const DISCORD_INVITE_URL = 'https://discord.gg/4GAkKqgDtX';

export const COMMUNITY_LINKS = {
  discord: DISCORD_INVITE_URL,
} as const;

export type CommunityLinkName = keyof typeof COMMUNITY_LINKS;
