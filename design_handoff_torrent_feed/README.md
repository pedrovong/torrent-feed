# Handoff: Torrent Feed (mobile app + backend)

## Overview
A mobile app for triaging a feed of torrents. A backend server continuously ingests torrent feeds (RSS etc.) into a database. The app lists new items; the user swipes to send one to a torrent client (Transmission) or hide it, or taps for details (description, prefetched images). The app also administers the backend (sources, polling, settings). Interaction style is gesture-first triage, similar in spirit to Narwhal for Reddit, with an original visual design.

Scope for Claude Code: build **both the mobile app and the backend**.

## About the Design Files
`Torrent Feed.dc.html` is a **design reference built in HTML**: a prototype showing intended look and behavior, not production code. Recreate it in a real mobile stack. Suggested: **React Native (Expo) + TypeScript** for the app (iOS first, Android works), or SwiftUI if you prefer iOS only. If the user has a preferred stack, use it. Do not ship the HTML.

Open the file in a browser. It is a pan/zoom canvas of phone mockups. **1b is the chosen feed design and the committed direction**; the detail screen inside 1b (tap a row) is the final detail design. Other frames:
- 1a, 1c: rejected feed alternatives. Ignore (1a's swipe-card look and 1c's button cards are not used).
- 1d: OLD detail mock. Superseded by the detail overlay in 1b.
- 1e Search, 1f Sources admin, 1g Settings: still valid screen content, but they currently show a bottom tab bar. **Final navigation has no tab bar** (see Navigation) so restyle them with a "‹ Today" style back button/title and reach them via the menu.

## Fidelity
**High-fidelity** for colors, type, spacing, radii, and interactions. Use the exact tokens below. Torrent names, counts, hostnames in the mock are placeholder data.

## Navigation
- No bottom tabs. Root screen is the **Feed** ("Today").
- Top-right circular `⋯` button opens a **floating menu** anchored under the button at the top-left of the screen (not a native action sheet): items **Feed, Search, Sources, Settings**, a divider, then a **theme toggle** ("Switch to dark" / "Switch to light"). Current screen item has green tint. Tap outside the menu (scrim) to close. Tapping an item should navigate (prototype only closes the menu).
- Feed row tap pushes **Detail** (slides in from right). Back = swipe left on detail, or "‹ Today" button.

## Screens

### 1. Feed ("Today") — frame 1b
Layout (390 wide phone; use safe areas): status bar, then header row (padding 6px 20px 8px): title "Today" 28/700, letter-spacing -0.5px, line-height 1.2; right: 34×34 circle button background `chip`, glyph `⋯` 16/700.
Filter chips row below (padding 0 16px 10px, gap 8, horizontal scroll): chips "All, TV, Movies, Music, Linux". Chip: 13/600, padding 7px 14px, pill. Selected: bg `#2f9e6e`, text white. Unselected: bg `chip`, text `sub`. Filters client-side or via API `category` param.
List: one inset grouped card (bg `card`, radius 16, overflow hidden), rows separated by 1px `line`. Content padding 0 16px 24px. Pull-to-refresh recommended; infinite scroll with cursor.

Row (padding 12px 14px, gap 12, flex):
- Left 4px wide vertical bar, radius 2, color = category foreground color.
- Middle (flex 1, min-width 0): title 14/600, line-height 1.3, clamp 2 lines, break-word. Below (margin-top 5, gap 8, wrap, 12px, `sub`): category · quality tags joined with " · " · size · age (e.g. "2h").
- Right (text-align right, 12/600, line-height 1.5): `▲ seeders` in `#2f9e6e`, `▼ leechers` in `sub`, and "Sent ✓" 11px green if already sent.

Swipe (the core interaction), per row:
- Drag horizontally; row follows finger (no transition while dragging, `transform .2s` on release).
- Behind the row: right-drag reveals green `#2f9e6e` with white "Download" (left aligned, padding-left 18); left-drag reveals gray `#6b7280` with white "Hide" (right aligned). Reveal opacity = min(1, |dx|/90).
- Release with dx > 90px: send to Transmission. dx < -90px: hide. Otherwise snap back. Movement < 8px = tap (open detail). Add haptic at threshold.
- Hide is gray, never red: it is non-destructive.
- After either action show a toast with **Undo** (3.5s). Undo reverts sent/hidden state (for send, if the client add already happened, call remove-torrent or just mark; see backend).
- Sent items stay in the list with "Sent ✓". Hidden items disappear.
- Empty state: "Nothing here." + "Reset demo" link (prototype only; replace with a real empty state).

### 2. Detail (overlay, slides over the feed)
Full-screen over the feed; bg `bg`; shadow `-8px 0 30px rgba(0,0,0,.18)`; enters with `translateX` 400→0, `.28s cubic-bezier(.2,.8,.2,1)`.
- Back "‹ Today" 16/600 green, padding 8px 16px.
- Scroll content (padding 4px 16px 20px):
  - Meta line 12/600 in category color: `{Category} · {Source feed name} · {age} ago`.
  - Title 21/700, line-height 1.3, break-word.
  - Quality tags: pills 11/600, padding 3px 8px, radius 6, bg `chip`, text `sub`.
  - Stats grid 3 cols gap 8 (margin-top 16): cards bg `card` radius 14 padding 11px 12px: label 12 `sub`; value 17/700. Size, Seeders (green), Leechers.
  - Section label "DESCRIPTION": 12/600 uppercase letter-spacing .5px `sub`, margin 20px 4px 8px. Card radius 16 padding 14: paragraphs 14/1.5, margin-bottom 10. Image URLs found in the description are listed below in green monospace 12px.
  - Section "IMAGES (n)" with right-aligned status: "Prefetching…" (sub) then "✓ Prefetched" (green). Each image block is centered, radius 14, overflow hidden, **sized to its aspect ratio**: poster (2:3) ~58% width, screenshots (16:9) 100%, cover (1:1) ~70%. Show a neutral placeholder at opacity .5 while loading, fade to full over .4s when loaded. In the mock these are striped placeholders; in the app render the real cached image. If none: "No images linked in this description."
  - Footer hint "Swipe left to go back" 12px `sub` (can be dropped).
- Pinned bottom bar (bg `bar`, top border `line`, padding 12px 16px 26px, gap 10): **Download** (flex 1, padding 15, radius 14, bg #2f9e6e, white 16/600). After sending: label "Sent to Transmission ✓", bg `#6b7280`. **Dismiss** (width 104, bg `chip`, text `fg`). Dismiss hides the torrent, closes detail, shows Undo toast.
- Swipe left (dx < -80px) on the detail dismisses back to the list at the **same scroll position and filter**. Detail follows the finger only for leftward movement. Pair with iOS edge-swipe-back if native navigation is used.
- Not in the prototype but required: full info hash, file list (name + size), and "Download to" folder picker (default from settings) as seen in old frame 1d. Add them below Stats.

### 3. Search (frame 1e)
Title "Search" 32/700. Input: margin 0 16, bg `chip`, radius 12, padding 11px 14px, 16px text, clear "✕". Filter chips: All sources, 1080p+, Seeds 50+, Last 7d (same chip style). Count "N results in backend database" 12px `sub`. Results in same inset card style as feed rows (title 14/600; cat, size, age; right `▲ seeds`). Search runs against the backend DB (full-text), not the client. Tapping a result opens Detail. Swipe actions same as feed.

### 4. Sources admin (frame 1f)
Title "Sources" 32/700 with green "Add" action right. Card 1: "Backend ingest" 15/600 with "Polling every 15 min · next in 6 min" and a "Poll now" pill button. Section "FEEDS": grouped list, each row: name 15/600, status line 12px (`sub`, or `#e5484d` for errors, e.g. "Error · 403 Forbidden", "Paused", "Updated 3 min ago · 214 items"), iOS-style switch right (51×31, on = #2f9e6e, off = `chip`, 27px white knob, 2px inset). Section "DATABASE": rows "Torrents indexed", "Prune items older than ›". Row tap should open a feed editor (URL, name, category, poll interval, auth/cookies, regex include/exclude, test fetch button) that is not yet designed: follow the grouped-list style of Settings.

### 5. Settings / server connect (frame 1g)
Grouped sections "FEED SERVER" (Address, API token, Status "● Connected · v1.4" in green), "TORRENT CLIENT" (Type: Transmission, RPC URL, Default folder, Start paused switch), a "Test connections" button (card bg, green 15/600 text), "APPEARANCE" (Theme: Match system / Light / Dark). Store the API token in the Keychain/Keystore.

## Interactions & Behavior summary
- Swipe thresholds: 90px on feed rows, 80px on detail. Haptics on trigger.
- Toast: bg #1c1c1f, white 14px, radius 16, padding 12px 16px, "Undo" in #5fd6a0 600, shadow `0 8px 24px rgba(0,0,0,.3)`, auto-dismiss 3.5s, positioned above bottom edge.
- Menu: scale .85→1 and translateX -40→0 plus opacity, `.22s cubic-bezier(.2,.8,.2,1)`, `transform-origin: left top`, shadow `0 12px 40px rgba(0,0,0,.28)`, radius 20, width 230, padding 8; items radius 12, padding 12, 15/600; scrim `rgba(0,0,0,.35)`.
- Image prefetch: when feed items arrive, the app (or backend, preferably) fetches image URLs found in descriptions so detail opens instantly. See backend.
- Loading: skeleton rows in feed; images show placeholder. Error: banner "Can't reach server" with retry; sources with errors show red status.
- Dark/light: toggle in menu, also follow system.

## State Management (app)
- `items` (paged from API), `filter.category`, `hiddenIds`, `sentIds` (source of truth is server; update optimistically), `lastAction` for Undo, `openId` for detail, `menuOpen`, `theme`, `settings` (server URL, token, default folder), `drag` state (per-row gesture, local).
- Use TanStack Query (or equivalent) for server data with optimistic updates for send/hide; secure storage for token.

## Backend (build this too)
Recommended: **Node + TypeScript (Fastify) or Python (FastAPI)**, **SQLite** (Postgres optional), a scheduler (node-cron / APScheduler), packaged with **Docker Compose** for home-server use. Single-user, token auth (`Authorization: Bearer <token>`), HTTPS via reverse proxy.

### Responsibilities
1. **Ingest**: for each enabled source, poll on its interval (default 15 min): fetch RSS/Atom (later: Torznab/JSON), parse items, normalize, dedupe by `info_hash` (fallback: normalized title + size), upsert. Backoff on errors; record `last_status`, `last_error`, `last_fetched_at`, `item_count`.
2. **Normalize**: parse category (TV/Movies/Music/Linux/Other), quality tags from title (resolution 720p/1080p/2160p, codec x264/x265, HDR, REMUX, WEB-DL, FLAC, ISO...), size, seeders/leechers (from feed attrs or optional scrape), published date, magnet/torrent URL, description HTML.
3. **Description images**: extract `<img src>` and image links from description; fetch server-side (size cap, timeout, content-type check), store thumbnails/resized copies on disk, record width/height so the app can size correctly. Serve through the API so the app never hits third-party hosts.
4. **Send to client**: `POST /items/:id/download` calls Transmission RPC (`torrent-add` with magnet/URL, `download-dir`, `paused`) handling the `X-Transmission-Session-Id` 409 handshake. Store result + client torrent id.
5. **Rules (optional later)**: auto-hide/auto-download by regex, category, min seeders.

### Data model
- `sources(id, name, url, type, category_default, enabled, interval_min, headers_json, include_regex, exclude_regex, last_fetched_at, last_status, last_error, item_count)`
- `items(id, source_id, info_hash UNIQUE, title, category, tags_json, size_bytes, seeders, leechers, published_at, magnet, torrent_url, description_html, state ENUM(new, sent, hidden), sent_at, client_torrent_id, created_at)`
- `item_files(item_id, path, size_bytes)`
- `item_images(id, item_id, source_url, local_path, width, height, status ENUM(pending, ok, failed))`
- `settings(key, value)` (client RPC URL/credentials, default folder, start_paused, prune_days)
- FTS index on `items.title` (+ description).

### API (JSON)
- `GET /items?state=new&category=&q=&cursor=&limit=` → `{items, next_cursor}` (list rows: id, title, category, tags, size_bytes, seeders, leechers, published_at, state, source_name)
- `GET /items/:id` → full detail incl. description (sanitized HTML or plain paragraphs), files, hash, images `[{id, url, width, height, status}]`
- `POST /items/:id/download` `{download_dir?, paused?}`; `POST /items/:id/hide`; `POST /items/:id/restore` (Undo: back to `new`)
- `GET /images/:id` (resized, cacheable)
- `GET/POST /sources`, `PATCH/DELETE /sources/:id`, `POST /sources/:id/test`, `POST /sources/:id/poll`
- `POST /ingest/poll` (poll all now); `GET /status` → `{version, next_poll_at, items_total, sources_ok, sources_error}`
- `GET/PUT /settings`, `POST /settings/test-client`
- `POST /maintenance/prune` `{older_than_days}`
- Optional: WebSocket/SSE `/events` for "new items" so the feed can show a "N new" pill.
Errors: `{error: {code, message}}`. Pagination by cursor on `(published_at, id)`.

### Security / safety
Server-side image fetch must block private-IP targets (SSRF), cap size/time, sanitize description HTML. Never expose Transmission credentials to the app beyond the settings screen. Rate-limit auth failures.

## Design Tokens
Font: system sans (`-apple-system`, SF Pro on iOS; Roboto on Android). Monospace `ui-monospace, Menlo` for URLs and hashes.

Colors, light / dark:
- bg `#f2f2f5` / `#0b0b0d`
- card `#ffffff` / `#1c1c1f`
- fg `#111114` / `#f5f5f7`
- sub (secondary text) `#6c6c75` / `#9a9aa2`
- chip `#e7e7ec` / `#2c2c30`
- line `rgba(0,0,0,.07)` / `rgba(255,255,255,.08)`
- bar `#fafafc` / `#141416`
- accent (download, links, selected) `#2f9e6e`; accent tint for selected menu item `rgba(47,158,110,.14)`
- hide / neutral `#6b7280`; error `#e5484d`; toast bg `#1c1c1f`; toast action `#5fd6a0`
Category colors (foreground; light-mode pill bg; dark-mode pill bg is `rgba(255,255,255,.08)`):
- TV `oklch(0.55 0.13 250)` / `oklch(0.9 0.05 250)`
- Linux `#b7791f` / `#fdf0d5`
- Movies `#b4503a` / `#fbe3dc`
- Music `#7c5cbf` / `#ece5fa`
Type scale: 32/700 (screen title; Feed title is 28/700), 21/700 detail title, 17/700 stat value, 16/600 buttons, 15/600 list primary, 14/600 row title, 14/400 body, 13 meta/chips, 12 captions, 11 tags. Title letter-spacing -0.5px.
Radii: 12 inputs/menu items, 14 stat cards/buttons/images, 16 grouped cards/toast, 20 menu, 999 pills/chips, 6 tag pills.
Spacing: 4-based; screen side padding 16 (detail/lists) or 20 (titles); gaps 6/8/10/12.
Shadows: toast `0 8px 24px rgba(0,0,0,.3)`; menu `0 12px 40px rgba(0,0,0,.28)`; detail edge `-8px 0 30px rgba(0,0,0,.18)`.

## Assets
No bitmap assets or icon fonts. Glyphs used (`▲ ▼ ⋯ ‹ ✓ ✕ ●`) are text characters; replace with SF Symbols / vector icons in the app. Image slots in Detail are placeholders for real fetched images. No brand assets.

## Suggested build order
1. Backend: schema, source CRUD, RSS ingest + normalization, `/items` list/detail, hide/restore.
2. Transmission integration + `/download`.
3. Image extraction/caching.
4. App: Feed (swipe, undo, filters) → Detail (images, buttons, swipe back) → Menu/theme → Settings → Sources admin → Search.
5. Polish: haptics, skeletons, error states, pull-to-refresh, "N new" pill.

## Files
- `Torrent Feed.dc.html`: the design reference (open in a browser; needs `support.js` beside it).
- `support.js`: runtime for the HTML reference.
