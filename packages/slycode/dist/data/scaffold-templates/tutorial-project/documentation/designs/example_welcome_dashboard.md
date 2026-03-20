# Design: Welcome Dashboard

**Status:** Drafting
**Created:** 2026-01-15

## Problem Statement

When users open the personal site, they land on a generic "About Me" page with no
dynamic content. Returning visitors see the same static text every time. There's no
quick summary of what's new or what I'm working on.

## Goals

1. Show a personalized greeting based on time of day
2. Display the 3 most recent blog posts
3. Show current project status (pulled from GitHub)
4. Load fast — no client-side API calls on initial render

## Non-Goals

- Full analytics dashboard
- User authentication or personalization
- RSS feed generation

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data fetching | Server-side (SSR) | Avoids loading spinners, better SEO |
| GitHub integration | REST API, cached 5 min | GraphQL is overkill for 3 fields |
| Greeting logic | Server-side, timezone from header | No geolocation API needed |
| Layout | Single column, cards | Matches existing site design language |

## Open Questions

- Should the dashboard replace the current homepage or be a separate `/dashboard` route?
- How to handle GitHub API rate limits if the cache expires during a traffic spike?
- Do we want a "now playing" Spotify widget? Fun but adds complexity and a new API dependency.
