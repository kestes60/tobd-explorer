# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TOBD Explorer is a single-page interactive web app for the Institute for Creation Research's Theory of Biological Design (TOBD), developed by Dr. Randy Guliuzza. It is an independent educational project, not officially affiliated with ICR.

The entire app lives in one file: `tobd-explorer.html` (intended to become `index.html` for GitHub Pages deployment from `main` branch root).

## Architecture

**Single-file HTML app** — all CSS, HTML, and JavaScript are inline. No build tools, no dependencies, no package manager.

### Key sections of `tobd-explorer.html`:
- **CSS** (~196 lines): Custom properties in `:root`, dark theme with gold/teal accents. Fonts loaded from Google Fonts (Playfair Display, IBM Plex Sans, IBM Plex Mono).
- **HTML** (lines ~198–324): Nav, hero with animated ring diagram, paradigm reversals carousel with detail panel, case studies grid, quote section, footer.
- **JavaScript** (lines ~326–478): All logic is vanilla JS with no frameworks.

### Core JS data & functionality:
- `reversals[]` array (6 items): Each has `num`, `title`, `desc`, `wrongH/wrongB`, `rightH/rightB` — drives the carousel and detail panel.
- **Carousel**: Paginated (4 cards per page), with `renderCards()`, `shiftPage()`, `selectReversal()`, dot navigation.
- **AI Q&A**: `askAI()` calls an API endpoint, scoped to the active reversal's context. Session-limited to 5 questions via `questionsLeft` counter.

### API Integration

The `askAI()` function fetches from an API endpoint (currently `https://api.anthropic.com/v1/messages`). Per project instructions, this should be replaced with the Cloudflare Worker proxy: `https://tobd-api-proxy.kestes60.workers.dev/` — and the `Content-Type` header removed (the Worker handles auth).

The request sends: `model`, `max_tokens`, `system` prompt (TOBD guide persona), and `messages` with reversal context + user question.

## Development

No build step. Open the HTML file directly in a browser or serve with any static server:

```
python3 -m http.server 8000
# or
npx serve .
```

## Deployment

Target: GitHub Pages from `main` branch root. The HTML file should be named `index.html`. Repo: `kestes60/tobd-explorer`.
