# Backlog

Log bugs and feature ideas here. Newest first within each section. Move finished items to "Done" with the date.

## Bugs
- _(none logged yet)_

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
- 2026-10-03: Initial build: backend, web app, Docker image, TrueNAS deploy YAML.
