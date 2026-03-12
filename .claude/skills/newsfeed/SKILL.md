# TOBD Newsfeed — Architecture & Patterns

## Overview
The newsfeed is a Cloudflare Worker that fetches RSS feeds daily,
runs each article through Claude Haiku for TOBD analysis, and
caches results in Cloudflare KV. The frontend fetches from the
Worker endpoint — it never calls the Anthropic API directly.

## Workers
- **tobd-newsfeed**: https://tobd-newsfeed.kestes60.workers.dev
  - GET /newsfeed → serves cached JSON from KV
  - POST /refresh → triggers fresh RSS fetch + Claude analysis
  - Cron: 0 6 * * * (daily 6am UTC)
- **tobd-api-proxy**: https://tobd-api-proxy.kestes60.workers.dev
  - Forwards requests to Anthropic API (handles CORS)
  - NEVER call api.anthropic.com directly from index.html

## KV
- Namespace: TOBD_NEWSFEED
- Key: feed_items (JSON array, max 30 items)
- To reset: delete feed_items key in Cloudflare dashboard,
  then POST /refresh

## RSS Sources
- ICR.org: https://www.icr.org/rss/news.xml (creation)
- Acts & Facts: https://www.icr.org/rss/acts_facts.xml (creation)
- ARJ: https://answersresearchjournal.org/feed/ (creation)
- AiG: https://answersingenesis.org/feed/ (creation)
- Phys.org: https://phys.org/rss-feed/biology-news/ (secular)
- EurekAlert: https://www.eurekalert.org/rss.xml (secular)
- Fetched via allorigins.win proxy (required — direct fetch blocked)

## Claude Models
- Haiku (claude-haiku-4-5-20251001): batch RSS processing in Worker
- Sonnet (claude-sonnet-4-20250514): interactive Q&A in index.html

## Biology Filter
Worker prompt does a relevance check first — non-biology articles
(astronomy, physics, geology) return {"skip": true} and are dropped.

## Deploying Worker Changes
CC edits tobd-newsfeed-worker.js and pushes to GitHub.
Keith manually copies updated code into Cloudflare dashboard and
clicks Save & Deploy. GitHub and Cloudflare are NOT automatically
synced.

## Share Text
X posts built fresh from item.headline + item.tobd (not
item.shareText) — kept under 250 chars for X's 280 char limit.
