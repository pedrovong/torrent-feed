# Backlog

Log bugs and feature ideas here. Newest first within each section. Move finished items to "Done" with the date.

## Bugs
- Detail page never loads the description or images: shows "Blocked by site bot protection (HTTP 403). Add cookies under the source's detail headers". Expected: description and images come through without manual cookie setup. Related to the bot-protection improvement below. Found 2026-10-03.

## Improvements
- Feed empty state should say "No feeds yet" with an "Add a feed" button when no sources exist (currently shows "Nothing here" + "Poll now", which does nothing without a source). Found 2026-10-03.
- Detail page fetch for Knaben/1337x is blocked by bot protection; consider a better path (e.g. a browser-cookie helper, a different index with descriptions, or fetching file lists via torrent metadata).
- Pruned items that are still in a feed reappear as new; consider a tombstone for pruned/hidden hashes.

## Ideas (from the handoff, not built)
- Auto-hide / auto-download rules (regex, category, min seeders).
- SSE `/events` for live "N new" updates (currently polls `/status?since=`).
- Torznab search (currently RSS poll only).
- Native-style haptics on iOS (not possible in Safari).

## Done
- 2026-10-03: Replaced the Today category chips with a Sort picker (Newest, Most seeders, Most leechers, Title A–Z); choice is remembered. Server `/items` takes `sort` with stable keyset paging. "By description" was implemented as title A–Z. Awaiting a phone check.
- 2026-10-03: Added an ascending/descending toggle (↑/↓ button next to the Sort picker); picking a sort resets to its natural direction (title A–Z, others high-to-low). `/items` takes `order=asc|desc`.
- 2026-10-03: Pull-to-refresh froze halfway on Edge/iOS; replaced with a "Refresh feeds" item in the ⋯ menu that toasts "N new items added" / "No new items" / failure. Confirmed on iPhone.
- 2026-10-03: Feed list was wider than the iPhone screen and drifted sideways (`overflow-x: clip` on html/body, closed menu `visibility: hidden`). Confirmed on iPhone.
- 2026-10-03: Initial build: backend, web app, Docker image, TrueNAS deploy YAML.
