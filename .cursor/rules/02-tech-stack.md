---
description: ITV stack, folder layout, API/socket conventions, env, and coding patterns
alwaysApply: true
---

# INTO THE VOID — Tech Stack & Conventions

## Stack (fixed unless user says otherwise)

| Layer | Choice |
|-------|--------|
| Runtime | Node.js **18+** |
| HTTP | Express 4 |
| Real-time | Socket.io 4 |
| Database | MongoDB via **Mongoose 8** |
| Auth | JWT + bcrypt (Phase 2A+) |
| Frontend | Vanilla HTML, CSS, JavaScript — **no framework** |
| Video | YouTube IFrame Player API (`public/js/player.js`) |
| Hosting target | Render (backend) + MongoDB Atlas |

## Project layout

```
ITVLIVE/
├── public/
│   ├── css/          variables.css → layout.css → components.css (load in this order)
│   ├── js/
│   │   ├── app.js    Main Stage UI + Socket.io client
│   │   ├── player.js YouTube IFrame API wrapper (ITVPlayer)
│   │   └── ambient.js
│   ├── index.html    Main Stage
│   ├── home.html
│   └── about.html
├── server/
│   ├── index.js      Express app, static files, /health, YouTube proxy routes
│   ├── config/       db.js, permissions.js, levels.js
│   ├── models/       Mongoose schemas
│   ├── routes/       REST: auth, admin, shop, history
│   ├── middleware/   auth.js, rateLimit.js
│   ├── services/     room.js, youtube.js, stats.js, playHistory.js
│   └── sockets/      index.js — all socket handlers
├── docs/WORKING-PLAN.md
├── .env.example
├── package.json
└── render.yaml
```

## npm scripts

```powershell
npm.cmd install    # Windows PowerShell — use npm.cmd if scripts blocked
npm.cmd start      # node server/index.js
npm run dev        # node --watch server/index.js
```

Local URLs: `http://localhost:3000/home.html`, `http://localhost:3000/index.html`, `/health`.

## Environment variables

```env
PORT=3000
MONGODB_URI=              # empty OK until Phase 2 — app runs guest-only
JWT_SECRET=               # long random string (Phase 2A+)
CLIENT_ORIGIN=http://localhost:3000
BOOTSTRAP_ADMIN_EMAIL=    # optional first admin seed (Phase 3C)
```

`connectDB()` in `server/config/db.js` skips Mongo when `MONGODB_URI` is unset — **do not require DB for local Phase 1 testing**.

## REST endpoints (existing + planned)

| Method | Path | Status |
|--------|------|--------|
| GET | `/health` | Live — `{ ok, name, phase }` |
| GET | `/api/youtube/:videoId/storyboard` | Live |
| GET | `/api/youtube/proxy-image?url=` | Live — ytimg.com only |
| POST | `/api/auth/register` | Phase 2A |
| POST | `/api/auth/login` | Phase 2A |
| GET | `/api/auth/me` | Phase 2A |
| PATCH | `/api/auth/profile` | Phase 2A |
| GET/POST | `/api/shop/*` | Phase 3B |
| GET/POST | `/api/admin/*` | Phase 3C |

Use `express.json()`, CORS with `credentials: true`, origin from `CLIENT_ORIGIN` or `RENDER_EXTERNAL_URL`.

## Socket.io conventions

### Server setup (`server/sockets/index.js`)

- Single in-memory `Room` instance for the global stage.
- CORS: `origin: true`, `credentials: true`.
- Use **ack callbacks** for mutations: `(payload, ack) => { ...; if (typeof ack === 'function') ack(result); }`.

### Client setup (`public/js/app.js`)

- Connect with `auth: { displayName }` (Phase 1) → add `auth: { token }` when logged in (Phase 2A).
- Wrap emits in a helper that returns Promises from ack callbacks.

### Event naming — `namespace:action`

| Client → Server | Purpose |
|-----------------|---------|
| `user:setName` | Guest display name |
| `playlist:add` | `{ url }` |
| `playlist:remove` | `{ itemId }` |
| `playlist:reorder` | `{ orderedIds }` |
| `playlist:rip` | Copy now playing to playlist |
| `queue:join` / `queue:leave` | DJ queue |
| `queue:skip-mine` | Leave queue / remove waiting slot |
| `queue:skip-current` | DJ or admin/mod skip now playing |
| `chat:send` | `{ text }` — max 280 chars, cooldown ~800ms |
| `player:ended` | Backup track end signal |
| `vote:submit` | `{ playSessionId, score }` — Phase 3A |
| `queue:priorityAdd` | Host — Phase 3C |
| `mod:timeout` / `mod:kick` / `mod:clearChat` | Phase 3C |

| Server → Client | Purpose |
|-----------------|---------|
| `room:state` | Chat, users, queue, nowPlaying — **does not touch player** |
| `player:sync` | `{ videoId, title, djName, startedAt, isPlaying, playSessionId? }` |
| `playlist:sync` | User's playlist array |
| `vinyl:votePulse` | Anonymous pit animation — Phase 3A |

### Broadcast rules

- **`broadcastRoom(io)`** → `room:state` only (chat/users/queue).
- **`emitPlayerSync(io)`** → `player:sync` only when now playing changes.
- Never emit `player:sync` on every chat message.

## Room service patterns (`server/services/room.js`)

- Identity key: `socketId` (always); add `userId` when authenticated.
- Playlists: `Map<socketId, Item[]>` in memory; persist to Mongo for logged-in users (Phase 2A).
- `getPlayerSync()` returns `{ videoId, title, djName, startedAt, isPlaying }`.
- `nowPlaying.startedAt` is `Date.now()` at track start — clients compute seek offset.
- Chat ring buffer: max **80** messages.

Return shapes from mutations: `{ ok: true, ... }` or `{ error: 'message' }` — never throw to client without catch in socket handler.

## YouTube service (`server/services/youtube.js`)

- `parseYoutubeId(url)` — supports watch, youtu.be, embed, shorts.
- `fetchYoutubeMeta(videoId)` — oEmbed + optional watch-page scrape for duration.
- Scraping is **best-effort**; may break. Do not add heavy caching without user request.
- Validate all URLs server-side; never trust client-provided titles/durations for queue authority.

## Player client (`public/js/player.js`)

- Global `ITVPlayer` IIFE wrapping YT IFrame API.
- `sync(payload)` — signature `videoId:startedAt`; seek if drift **> 12s**; do not restart same track unnecessarily.
- `setOnEnded(fn)` — backup end detection; server timer is primary (Phase 0+).

## Mongoose models (target schema)

Implement per `docs/WORKING-PLAN.md` Phase 0:

- **User** — email, passwordHash, username, level, staffRole, avatarUrl, customSaying, badges[], tokenBalance, stats, cosmetics, createdAt
- **Song** — youtubeId (unique), title, durationSec, lifetime aggregates
- **PlaySession** — songId, playedByUserId, startedAt, endedAt, averageScore, listenerCount
- **Vote** — playSessionId + userId (unique compound index), score 1–100
- **PlaylistItem** — userId, videoId, title, order, metadata
- **TokenTransaction** — userId, amount, reason, createdAt

Indexes: unique `email`, unique `username`, unique `youtubeId`, unique `(playSessionId, userId)` on Vote.

## Auth pattern (Phase 2A+)

- REST: `Authorization: Bearer <jwt>` header.
- Socket: `handshake.auth.token` — verify before `room.addUser`, attach full user or reject to guest fallback per working plan.
- JWT payload: `{ userId, username, level, staffRole }` — refresh from DB on sensitive actions if needed.

## Security checklist (apply as features land)

- Rate-limit auth, chat, votes.
- Sanitize/escape chat HTML on render (`escapeHtml` in app.js).
- Permission check on every mod/host/admin socket handler.
- Idempotent token grants (no double pay per playSession).
- CORS locked to production origin on deploy.

## Code style

- CommonJS (`require` / `module.exports`) — match existing server files.
- Frontend: plain ES in script tags / IIFEs; no bundler.
- Prefer async/ack in socket handlers with try/catch.
- Minimal dependencies — justify new packages to user.
- Windows dev: document `npm.cmd` in README when adding scripts.

## Testing locally

1. `npm.cmd start` — one terminal.
2. Open two tabs (or incognito) on `/index.html`.
3. `/health` should respond JSON.
4. After changes: queue, chat, player sync, skip, rip still work for guests.

## Deploy notes (`render.yaml`)

- Set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` on Render.
- Free tier sleeps — room state resets; document for user.
- HTTPS required before WebRTC mic (Phase 5).
