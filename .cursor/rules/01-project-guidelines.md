---
description: ITV product vision, features, roles, architecture, and development direction
alwaysApply: true
---

# INTO THE VOID (ITV) — Project Guidelines

## What this project is

**INTO THE VOID** is a community music room: one shared YouTube player, live chat, personal playlists, a global DJ queue, voting, tokens, and **The Vinyl Pit** (every online user as a spinning vinyl record). Theme: dark void / black hole — purple, black, greys, skulls/flames in branding.

**Do not** turn this into a generic SPA or switch stacks without explicit user request. Extend what exists.

## Source of truth for phased work

Follow **`docs/WORKING-PLAN.md`** for step-by-step phases, checklists, and Cursor prompts. This rule file is the **always-on compass**; the working plan is the **detailed roadmap**.

**Current baseline:** Phase 1 done — live room, YouTube player, chat, playlists, DJ queue, display names (no accounts yet).

## Main Stage layout (do not rearrange without reason)

| Area | Purpose |
|------|---------|
| Top nav | Logo, Home / About / Main Stage, user info / login / settings |
| Centre | YouTube player + DJ banner + media controls + vote slider |
| Left panel | Personal playlist (top song feeds queue when user joins) |
| Right panel | Tabs: Live Chat, Online Users, DJ Queue |
| Bottom | **The Vinyl Pit** — full-width, all online users as vinyl records |

Real-time sync (chat, queue, player, pit) must use **Socket.io**. Player sync is server-authoritative via `startedAt` + `videoId`.

## User roles — two fields, never one

| Field | Values | Meaning |
|-------|--------|---------|
| `level` | 1–5 | **Earned:** Newcomer → Member → Regular → Veteran → Elite |
| `staffRole` | `null`, `resident`, `host`, `mod`, `admin` | **Assigned** permissions |

A user can be Level 3 **and** Host. Do not collapse these into a single `role` string.

### Level names

1. Newcomer — new account  
2. Member — verified, can vote  
3. Regular — active in chat/queue  
4. Veteran — long-term, high engagement  
5. Elite — top tier / shop upgrade  

### Staff capabilities (enforce on **server**, not client-only)

| Role | Powers |
|------|--------|
| **Resident** | Profile badges / recognition (cosmetic unless extended) |
| **Host** | Live mic toggle (future WebRTC), master queue controls, priority track add |
| **Mod** | Chat timeout/kick, clear chat, skip rule-breaking songs |
| **Admin** | Role assignment, platform settings, full override, admin panel |

Use **`server/config/permissions.js`** (`can(user, action)`) for every privileged socket/route. Default thresholds live in **`server/config/levels.js`**.

## Core features & rules

### Playlists & queue

- Users add songs via **YouTube URL** (validated server-side).
- **Join Queue** puts the user in the global DJ rotation; their playlist head plays when it is their turn.
- **Rip** copies the currently playing track metadata into the user's playlist.
- Skip now-playing: **current DJ** or **admin/mod** (when mod tools exist). Skip waiting slot: own queue entry only.
- Queue rotation: after a DJ's song finishes, they move to the **bottom** of the queue.

### Voting

- Anonymous to the room: **1–100** slider while a song plays.
- **Level 2+** only (Member and above).
- **One vote per user per play session** — store in `Vote` collection, not duplicated on User as a blob.
- Show **aggregate** scores (avg / high / low) **after** the song ends — not live per-user scores.

### Tokens

- **+1** listener: connected for ≥90% of song duration (server-timed, not client-trusted).
- **+3** DJ: when their song finishes playing.
- Spend in **Token Shop**: rank upgrades, vinyl borders, username colors.
- Log every change in **`TokenTransaction`**.

### Statistics

Persist two concepts:

1. **`Song`** — catalog by `youtubeId` + lifetime stats (plays, listeners, all-time high/low/avg).
2. **`PlaySession`** — one room play (`playedByUserId`, `startedAt`, `endedAt`, session scores).

User profile stats (`totalPlays`, `totalListens`, `votesGivenCount`, `avgScoreReceivedAsDj`) are **aggregates**, not the raw vote list.

## Memory vs database

| Live / ephemeral (`server/services/room.js`) | Persistent (MongoDB) |
|---------------------------------------------|----------------------|
| Chat buffer, online users, global queue | Users, playlists, auth |
| `nowPlaying`, socket mapping | PlaySession, Vote, Song, tokens |

On server restart, live room state may reset — that is acceptable for MVP; do not block Phase 1 guest flow when `MONGODB_URI` is empty.

## Development principles

1. **Minimal scope** — smallest correct change; match existing patterns in `room.js`, `sockets/index.js`, `app.js`.
2. **Server authority** — queue, votes, tokens, permissions, track end timing are validated server-side.
3. **Guest mode** — keep working until the working plan says otherwise (logged-in users get `userId`; guests keep `socketId` + display name).
4. **No secrets in git** — `.env` only; document vars in `.env.example`.
5. **Never store plain passwords** — `passwordHash` (bcrypt) only.
6. **YouTube constraints** — some videos block embed; metadata scraping is fragile; prefer official Data API when added. Do not download/re-host YouTube audio.
7. **Player sync** — `player:sync` drives the YouTube iframe; `room:state` must **not** reload the player on every chat update.
8. **Track end** — prefer server timer (`duration` + `startedAt`); `player:ended` is backup only; prevent double-advance.

## Known risks (do not ignore)

- YouTube ToS / embed restrictions may break tracks or the project long-term.
- Perfect A/V sync across all clients is **not** achievable — ~12s drift correction is normal.
- WebRTC mic + YouTube ducking is **Phase 5** — complex; do not half-implement in earlier phases.
- Vinyl Pit animations: throttle on mobile; cap animated discs if performance drops.

## What not to do

- Do not add React/Vue/webpack unless explicitly requested.
- Do not commit `.env`, credentials, or JWT secrets.
- Do not trust client for votes, tokens, skips, or role checks.
- Do not create commits or PRs unless the user asks.
- Do not rewrite unrelated files when fixing a single feature.

## Key file map

```
public/           HTML, CSS, JS (Main Stage: index.html, app.js, player.js)
server/index.js   Express + static + health
server/sockets/   Socket.io handlers
server/services/  room.js (live state), youtube.js (URL/meta)
server/config/    db.js, permissions.js, levels.js (as added)
server/models/    Mongoose schemas (Phase 0+)
docs/WORKING-PLAN.md  Phased build plan + prompts
```

## When starting a new feature

1. Check which **phase** in `docs/WORKING-PLAN.md` it belongs to.
2. Confirm it fits the permission matrix and data model above.
3. Implement server logic first, then socket events, then UI.
4. Preserve Phase 1 behaviour for guests where applicable.
5. Update working plan checkboxes only if the user asks.
