# Torrent Feed: project notes for Claude

Self-hosted PWA + backend for triaging torrent feeds with swipe gestures and sending items to Transmission. Design source of truth: `design_handoff_torrent_feed/` (README.md is the spec; `Torrent Feed.dc.html` is the prototype). User-facing docs: `README.md`. Bugs and ideas: `BACKLOG.md` (update it as items are logged or fixed).

## Layout
- `server/` Fastify 5 + TypeScript (ESM, NodeNext, `.js` import suffixes) + better-sqlite3 (FTS5). Entry `src/index.ts`, routes in `src/routes.ts`, ingest/scheduler `src/ingest.ts`, detail-page + image pipeline `src/details.ts` / `src/detailParser.ts`, SSRF-safe fetch `src/safeFetch.ts`, Transmission RPC `src/transmission.ts`, source parsers `src/sources/` (Knaben JSON, RSS/Torznab). Tests: `src/server.test.ts` (vitest).
- `web/` React 19 + Vite 6 + TanStack Query + vite-plugin-pwa. Hash routing (`src/nav.ts`), swipe gestures via pointer events (`components/SwipeRow.tsx`, `screens/Detail.tsx`), optimistic send/hide + Undo (`src/actions.ts`), design tokens in `src/theme.css`. Config (server URL, token, theme) in localStorage (`src/store.ts`).
- `Dockerfile` (3-stage, node:22, runs as `node`), `docker-compose.yml`, `deploy/truenas-app.yaml` (TrueNAS "Install via YAML": pulls `ghcr.io/pedrovong/torrent-feed:latest` and runs watchtower for auto-updates; image is built by `.github/workflows/docker.yml` on push to main), `deploy/*.tar.gz` (saved image, gitignored).

## Commands
- Server dev: `cd server && API_TOKEN=devtoken npm run dev` (port 8080). Tests: `npm test`. Typecheck: `npx tsc --noEmit`.
- Web dev: `cd web && npm run dev` (proxies /api to :8080). Build: `npm run build`.
- Image: `docker build -t torrent-feed:latest .` then `docker save torrent-feed:latest | gzip > deploy/torrent-feed-image.tar.gz`.
- API is under `/api`, bearer token from `API_TOKEN` (or generated into `/data/api-token`).

## Status (as of 2026-10-03, end of day)
- Built to full handoff scope: ingest, items API, Transmission send/undo, image caching, Feed, Detail, menu/theme, Settings, Sources + feed editor, Search, PWA, Docker.
- Verified: 20 unit tests; real Knaben ingest (100 items); Docker image builds, runs as uid 568, healthy, data persists across restart; send/duplicate/undo against a real Transmission 4.1.3 container; user tested locally in browser ("works well").
- Deployed to TrueNAS SCALE 25.10.7 as a custom app from `deploy/truenas-app.yaml`; auto-deploys on push to main (GitHub Actions → public GHCR image → watchtower). Confirmed working. Repo is public.
- Added since: Refresh feeds menu item (replaced pull-to-refresh, which froze on Edge/iOS), sort picker + asc/desc on Today (category chips removed), iOS width fix. Checked on iPhone 15 Pro in Edge.
- Not verified: PWA install over HTTPS, docker-compose.yml, reverse proxy.
- Next up (see BACKLOG.md): detail page 403 (description/images).

## Known issues and gotchas
- **Detail pages are bot-protected**: `knaben.xyz/*/description.php` returns 403 (anti-bot challenge) to the server; `1337x.to` timed out from the dev machine. Detail parsers are only unit-tested on sample HTML. The UI shows the failure with Retry; workaround is per-source "Detail page headers" (cookies + UA). Knaben API itself has no description/images/files.
- Dependency pins exist for Node 20.17 compatibility: `better-sqlite3@^12` (v13 segfaults), `@fastify/static@^8` and no `sanitize-html` (newer ones need `require(esm)`; sanitizing is done with cheerio in `detailParser.ts`), `vitest@^3`. If npm complains about rolldown/native bindings, delete node_modules and package-lock.json and reinstall.
- Docker named volumes inherit the image's `/data` ownership (uid 1000); with `user: 568:568` use a host path owned by 568 (TrueNAS datasets are fine).
- On Windows Git Bash, prefix docker commands with `MSYS_NO_PATHCONV=1` when passing container paths.
- Browser automation drag tool doesn't send pointerup; test swipes by dispatching `PointerEvent`s manually.
- Pruned items still in a feed reappear as new on the next poll.
- Haptics use `navigator.vibrate` (not on iOS Safari). API token lives in localStorage.
