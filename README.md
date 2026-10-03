# Torrent Feed

A self-hosted web app (installable PWA) for triaging a feed of torrents with swipe gestures, plus the backend that ingests feeds and sends items to Transmission. Design reference: `design_handoff_torrent_feed/`.

- **Swipe right** a row to send it to Transmission, **swipe left** to hide it, **tap** for details. Every action has an Undo toast.
- **Backend** (Fastify + SQLite) polls your sources, dedupes by info hash, parses quality tags, serves the API and the built web app from one container.
- **Sources**: Knaben JSON API and RSS / Atom / Torznab (Jackett, Prowlarr).

```
server/   Fastify + TypeScript + SQLite (better-sqlite3, FTS5 search)
web/      React + Vite + TanStack Query PWA
Dockerfile, docker-compose.yml   single image, one port, one /data volume
```

## Run locally (development)

Node 20+ required.

```bash
# terminal 1: API on :8080
cd server && npm install && API_TOKEN=devtoken npm run dev

# terminal 2: web on :5173 (proxies /api to :8080)
cd web && npm install && npm run dev
```

Open http://localhost:5173, go to **Menu → Settings**, and enter the API token. Then **Menu → Sources → Add** and paste a feed URL, e.g. your Knaben query:

```
https://api.knaben.org/v2/browse?c=2000000%2C1001000&t=thepiratebay%2C1337x&o=date&d=desc&s=100&f=0&xxx&unsafe&dead&seen=604800
```

Tests: `cd server && npm test`.

## Deploy on TrueNAS SCALE

The image has to exist before TrueNAS can run it (custom apps can't build from a Dockerfile). Pick one:

**A. Build on the NAS shell** (simplest, no registry)

```bash
git clone <your repo> /mnt/tank/apps/torrent-feed-src   # or copy this folder over
cd /mnt/tank/apps/torrent-feed-src
docker build -t torrent-feed:latest .
```

**B. Build elsewhere and push** to GHCR / Docker Hub, then reference that image name in the app.

Then create the app (Apps → Discover Apps → **Custom App** → *Install via YAML* on 24.10+; or the Custom App form on older releases):

```yaml
services:
  torrent-feed:
    image: torrent-feed:latest        # or ghcr.io/<you>/torrent-feed:latest
    restart: unless-stopped
    user: "568:568"                   # TrueNAS "apps" user
    ports:
      - "8080:8080"
    environment:
      API_TOKEN: "<long random string>"
      TZ: "America/New_York"
    volumes:
      - /mnt/tank/apps/torrent-feed:/data
```

Create the dataset first and give it to the apps user:

```bash
chown -R 568:568 /mnt/tank/apps/torrent-feed
```

### Auto-deploy (GitHub Actions + GHCR + watchtower)

Every push to `main` builds an amd64 image (`.github/workflows/docker.yml`) and publishes `ghcr.io/pedrovong/torrent-feed:latest`. `deploy/truenas-app.yaml` runs that image plus a watchtower container that polls GHCR every 5 minutes and recreates the app when the image changes. Because the package is private:

1. Create a GitHub personal access token (classic) with only the `read:packages` scope.
2. On the NAS shell, log in once so the first pull works: `docker login ghcr.io -u pedrovong` (paste the token).
3. Put the same token in `REPO_PASS` in the YAML, set `API_TOKEN` and your pool path, and install the app via YAML.

After the first successful workflow run, new commits reach the NAS within about 5 minutes. Data in `/data` is untouched by updates.

**Transmission**: in the app's Settings, set RPC URL to wherever Transmission listens, e.g. `http://<truenas-ip>:9091` (the backend adds `/transmission/rpc`). The backend, not your phone, talks to Transmission, so it only needs to be reachable from the container. If Transmission runs as another TrueNAS app, use the NAS IP and its published port rather than `localhost`. The *Default folder* is a path **as Transmission sees it**.

### HTTPS / reverse proxy

iOS only allows "Add to Home Screen" with a service worker (offline shell, auto-update) over HTTPS, and the clipboard buttons need it too. Put a reverse proxy in front (Caddy, Nginx Proxy Manager, Traefik) and forward your hostname to `:8080`. Caddy example:

```
feed.example.com {
    reverse_proxy truenas.local:8080
}
```

Nothing else is needed: the API and web app share one origin, so there is no CORS setup. Failed token attempts are rate limited per IP (10/min), and `trustProxy` is on so the limiter sees the real client IP behind your proxy. **Do not expose port 8080 to the internet without HTTPS**: the token is a bearer token.

### Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `API_TOKEN` | generated | If unset, a token is generated once, saved to `/data/api-token` and printed in the log. |
| `DATA_DIR` | `/data` | SQLite DB and cached images. **Back this up.** |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `ALLOW_PRIVATE_HOSTS` | off | Set `1` only for testing: disables the SSRF guard on detail pages and images. |

## How it works

**Ingest.** Each enabled source is polled on its own interval (default 15 min) with exponential backoff on errors (up to 8x). Items dedupe on info hash (fallback: title + size). Seeder/leecher counts refresh on every poll. The status line on the Sources screen shows the last error.

**Descriptions and images.** Knaben's API returns no description, images or file list, only a `details` URL per item. The server fetches that page when you **open an item** (or in the background for new items if you enable *Prefetch descriptions* in Settings), extracts the description, images and file list, caches images as WebP on disk, and serves them through `/api/images/:id`. All third-party fetches block private/loopback addresses (re-checked on every redirect), cap size and time, and require an image content-type. Descriptions are sanitized and delivered to the app as plain paragraphs.

**Undo.** Hide is just a state flip. Undo after a send also calls Transmission `torrent-remove` (without deleting data) so the item really goes back to *new*.

### Known limitation: bot-protected detail pages

At build time, `knaben.xyz/*/description.php` answered with an anti-bot challenge (HTTP 403) and `1337x.to` was unreachable from the dev machine, so the **detail parsers are best-effort and untested against live pages** (they're covered by unit tests on representative HTML only). When a site blocks the server you'll see "Blocked by site bot protection" in the Description card with a Retry button and a link to open the page in your own browser. Options:

1. Per-source **Detail page headers** (Sources → edit feed): paste a JSON object like `{"Cookie": "cf_clearance=...", "User-Agent": "<same UA you used>"}` from a browser that already passed the challenge. These expire.
2. Use a feed that includes descriptions (many RSS/Torznab indexers do); those need no page fetch and images are extracted straight from the description.
3. Tune the selectors in `server/src/detailParser.ts` once you can see a real page.

Everything else in the detail screen (stats, tags, info hash, magnet, download folder) works without the page fetch.

## API

All under `/api`, `Authorization: Bearer <token>`, errors as `{error:{code,message}}`. See `server/src/routes.ts` for the authoritative list; it follows the handoff spec (`/items`, `/items/:id`, `/items/:id/download|hide|restore`, `/images/:id`, `/sources[...]`, `/ingest/poll`, `/status`, `/settings`, `/maintenance/prune`) plus `POST /sources/test` for testing an unsaved feed and `POST /items/:id/refresh-details`. `/status?since=<ms>` returns `new_since`, which drives the "N new" pill (no SSE needed).

## Notes and deviations from the handoff

- **Web, not native**: the token lives in `localStorage` (no Keychain in browsers), and haptics use `navigator.vibrate`, which works on Android but not iOS Safari.
- **No tab bar**; navigation is the `⋯` menu and "‹ Today" back buttons, as specified. Routes are hash-based, so the browser/OS back gesture closes the detail.
- **"Download to"** is a text field with your recent folders (Transmission's RPC can't list directories), defaulting to the folder in Settings.
- **Feed window**: "Today" shows new + sent items from the last 7 days (matching your Knaben `seen=604800`). Hiding is permanent until Undo; pruning deletes items older than N days except ones you sent.
- **Prune caveat**: a pruned item that is still present in a feed will come back as new on the next poll.
- Not built (spec marks as optional/later): auto-hide/auto-download rules, SSE events, Torznab search (RSS poll only).
- Docker image build was not run locally (daemon was off); the server compiles and runs from `dist/`, and the web build is verified.
