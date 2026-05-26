# INTO THE VOID — Working Plan

> **How to use this document**
>
> - Work through phases **in order** unless a step says it can run in parallel.
> - Check boxes as you complete tasks. Edit thresholds, permissions, and scope anytime.
> - Each step includes a **Cursor prompt** — copy it into a new Cursor chat when you start that step.
> - Keep `.env` secrets out of git. Use `.env.example` as the template.

**Project:** ITV (INTO THE VOID)  
**Stack:** Node.js, Express, Socket.io, MongoDB (Mongoose), vanilla HTML/CSS/JS  
**Current baseline:** Phase 1 complete (live room, chat, queue, playlists, display names only)

---

## Your decisions (edit before you build)

Fill these in so prompts and implementation stay aligned.


| Decision                        | Your choice                                   | Default in this plan                                    |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Guest access after login exists | ☐ Allow guests ☐ Login required on Main Stage | Allow guests on Main Stage                              |
| Email verification for Level 2  | ☐ Required ☐ Optional                         | Required (flag on user)                                 |
| Level 3 “shape queue” means     | *describe here*                               | Reorder own playlist + join queue (no extra powers yet) |
| Vote submit UX                  | ☐ On slider release ☐ Live as you drag        | On slider release                                       |
| Token: full listen rule         | Connected ≥ __% of song duration              | 90%                                                     |
| Token: DJ reward                | +__ tokens when your song finishes            | +3                                                      |
| Token: listener reward          | +__ tokens for full listen                    | +1                                                      |
| Avatar storage                  | ☐ URL only ☐ File upload to server/cloud      | URL only (Phase 2A)                                     |
| Deploy target                   | Render + MongoDB Atlas                        | Yes                                                     |


---

## Architecture reference

### Two role fields (not one)


| Field       | Values                                     | Purpose                  |
| ----------- | ------------------------------------------ | ------------------------ |
| `level`     | `1`–`5`                                    | Earned: Newcomer → Elite |
| `staffRole` | `null`, `resident`, `host`, `mod`, `admin` | Assigned permissions     |


### MongoDB collections


| Collection         | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `User`             | Account, level, staff role, tokens, stats, cosmetics |
| `Song`             | YouTube catalog + lifetime stats                     |
| `PlaySession`      | One play in the room (who DJ'd, when, scores)        |
| `Vote`             | One score per user per play session                  |
| `PlaylistItem`     | Saved user playlist rows                             |
| `TokenTransaction` | Audit log for token changes (Phase 3B)               |


### What stays in memory vs database


| In memory (`room.js`)          | In MongoDB                  |
| ------------------------------ | --------------------------- |
| Live queue, chat, online users | User accounts, playlists    |
| Current `nowPlaying`           | Play history, votes, tokens |
| Socket ↔ session mapping       | Song catalog aggregates     |


---

## Permission matrix (edit as needed)


| Action               | L1  | L2  | L3  | L4  | L5  | Resident | Host | Mod | Admin |
| -------------------- | --- | --- | --- | --- | --- | -------- | ---- | --- | ----- |
| Chat                 | ✓   | ✓   | ✓   | ✓   | ✓   | ✓        | ✓    | ✓   | ✓     |
| Join DJ queue        | ✓   | ✓   | ✓   | ✓   | ✓   | ✓        | ✓    | ✓   | ✓     |
| Vote (1–100)         |     | ✓   | ✓   | ✓   | ✓   | ✓        | ✓    | ✓   | ✓     |
| Rip song             | ✓   | ✓   | ✓   | ✓   | ✓   | ✓        | ✓    | ✓   | ✓     |
| Skip own now-playing | ✓   | ✓   | ✓   | ✓   | ✓   | ✓        | ✓    | ✓   | ✓     |
| Priority queue add   |     |     |     |     |     |          | ✓    |     | ✓     |
| Live mic toggle      |     |     |     |     |     |          | ✓    |     | ✓     |
| Timeout / kick chat  |     |     |     |     |     |          |      | ✓   | ✓     |
| Clear chat           |     |     |     |     |     |          |      | ✓   | ✓     |
| Mod skip any song    |     |     |     |     |     |          |      | ✓   | ✓     |
| Assign staff roles   |     |     |     |     |     |          |      |     | ✓     |
| Admin panel          |     |     |     |     |     |          |      |     | ✓     |


### Level-up thresholds (edit numbers)


| Level | Name     | Unlock when                                       |
| ----- | -------- | ------------------------------------------------- |
| 1     | Newcomer | Account created                                   |
| 2     | Member   | Email verified + **5** votes cast                 |
| 3     | Regular  | **30** days + **50** votes + **20** chat messages |
| 4     | Veteran  | **90** days + **200** listens + **10** DJ plays   |
| 5     | Elite    | Manual / token shop / top tier — *your rule:*     |


---

# Phase 0 — Foundation

**Goal:** Folder structure, Mongoose schemas, permissions config, and safer track-end logic — without breaking Phase 1 guest mode.

**Estimated time:** 1–2 days

### Tasks

- Create folders: `server/models/`, `server/routes/`, `server/middleware/`, `server/config/`
- Add `server/config/permissions.js` — `can(user, action)` helper
- Add `server/config/levels.js` — level names + threshold constants (editable)
- Add Mongoose models: `User`, `Song`, `PlaySession`, `Vote`, `PlaylistItem`
- User schema: `level`, `staffRole`, `passwordHash` (never plain password), stats fields
- Refactor `room.js` to support optional `userId` on connected users (keep `socketId` for guests)
- Add server-side track end timer using song `duration` + `startedAt` (keep `player:ended` as backup)
- Update `/health` to report phase `0` or `2` when DB connected
- Smoke test: Phase 1 still works with no `MONGODB_URI`

### Exit criteria

- App starts with or without MongoDB
- Schemas load without errors
- Two browser tabs still sync queue/chat/player
- Track advances if DJ client disconnects before `player:ended`

### Cursor prompt — Phase 0

```
Implement Phase 0 foundation for ITV (INTO THE VOID) in this repo.

Requirements:
1. Create server/models/ with Mongoose schemas: User, Song, PlaySession, Vote, PlaylistItem.
   - User: email, passwordHash, username, level (1-5), staffRole (null|resident|host|mod|admin),
     avatarUrl, customSaying, badges[], tokenBalance, createdAt, totalPlays, totalListens,
     votesGivenCount, avgScoreReceivedAsDj. Never store plain passwords.
2. Create server/config/permissions.js with can(user, action) using the permission matrix in docs/WORKING-PLAN.md.
3. Create server/config/levels.js with level names and threshold constants (editable config).
4. Refactor server/services/room.js so connected users can have optional userId (logged in) or socketId-only (guest).
   Do not break existing Phase 1 guest flow.
5. Add server-side track end: when nowPlaying starts, schedule end from duration + startedAt;
   keep player:ended as backup. Prevent double-advance.
6. App must still run when MONGODB_URI is empty (guest mode). Connect DB when URI is set.

Follow existing code style. Minimal scope — no login UI yet. Update docs/WORKING-PLAN.md checkboxes only if I ask.
After changes, tell me how to test locally.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 2A — Accounts & identity

**Goal:** Register, login, JWT auth on REST + Socket.io, persisted playlists, profile fields.

**Estimated time:** ~1 week  
**Depends on:** Phase 0

### Tasks

#### Backend

- Install: `bcryptjs`, `jsonwebtoken` (add to package.json)
- `POST /api/auth/register` — email, username, password → User level 1
- `POST /api/auth/login` — returns JWT
- `GET /api/auth/me` — requires JWT, returns profile
- `PATCH /api/auth/profile` — avatarUrl, customSaying (owner only)
- Unique indexes on `email` and `username`
- `server/middleware/auth.js` — verify JWT for REST
- Socket.io: accept JWT in `handshake.auth.token`; attach user to session
- Load/save playlist from `PlaylistItem` collection for logged-in users
- Optional: `emailVerified` flag + stub for future verification

#### Frontend

- `public/login.html` — login + register forms
- Store JWT in `localStorage` (or httpOnly cookie — *your choice:*)
- Pass token in socket `auth: { token }`
- Nav: show username + avatar; link to settings
- `public/settings.html` — edit avatar URL, custom saying
- Main Stage: if logged in, skip name modal; use account username
- Guest path still works if you chose to allow guests

### Exit criteria

- Register two users with different emails/usernames
- Login persists across page refresh
- Playlist survives server restart (with MongoDB running)
- Chat and Vinyl Pit show account username + avatar
- Invalid/expired JWT falls back to guest or prompts re-login

### Cursor prompt — Phase 2A

```
Implement Phase 2A — Accounts & identity for ITV.

Read docs/WORKING-PLAN.md for schema and permission decisions.

Backend:
- Add bcryptjs + jsonwebtoken.
- Routes: POST /api/auth/register, POST /api/auth/login, GET /api/auth/me, PATCH /api/auth/profile.
- JWT middleware for protected routes. Use JWT_SECRET from .env.
- Socket.io: verify JWT from handshake.auth.token; link socket to User via userId.
- Persist playlists in PlaylistItem for logged-in users (load on connect, save on add/remove/reorder).
- Keep guest mode working on Main Stage if no token (display name flow).

Frontend:
- login.html with register + login.
- settings.html for avatarUrl and customSaying.
- Update app.js to send JWT on socket connect; update nav on all pages.
- Logged-in users skip the name modal and use their username.

Match existing CSS (dark void theme). Do not implement voting or tokens yet.
Tell me exact .env vars needed and how to test with two accounts.
```

### Cursor prompt — Phase 2A fix-up (use if something breaks)

```
Phase 2A auth is partially working but I have this issue: [DESCRIBE ISSUE].

Please debug in the ITV repo. Check server/middleware/auth.js, socket auth in server/sockets/index.js,
and public/js/app.js token handling. Fix with minimal changes and give me steps to verify.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 2B — Play history & song catalog

**Goal:** Every song play creates a DB record; listen tracking for stats and future tokens.

**Estimated time:** 3–5 days  
**Depends on:** Phase 2A

### Tasks

#### Backend

- On track start: upsert `Song` by `youtubeId`; create `PlaySession`
- Include `playSessionId` in room state / player sync payload
- On track end: set `endedAt`, increment DJ `totalPlays`, update `Song.lifetimePlays`
- Listen heartbeat: every 30s while user connected and song playing
- On session end: if user was present ≥ __% of duration → increment `totalListens` (tokens in 3B)
- API (optional): `GET /api/history/recent` — last N play sessions

#### Frontend

- DJ banner shows account username (already partly done)
- Optional debug readout of `playSessionId` in dev only

### Exit criteria

- Play a full song → `PlaySession` and `Song` documents exist in MongoDB
- DJ `totalPlays` increments once per completed play
- Listener `totalListens` increments only after threshold rule
- Skip mid-song does not count as full listen

### Cursor prompt — Phase 2B

```
Implement Phase 2B — Play history & song catalog for ITV.

When a track starts in room.js:
- Upsert Song (youtubeId, title, durationSec, thumbnail metadata).
- Create PlaySession linked to Song and playedByUserId (DJ).
- Expose playSessionId in getRoomState / player sync.

When a track ends:
- Set endedAt, compute average placeholder if no votes yet.
- Increment DJ User.totalPlays and Song.lifetimePlays.

Listen tracking:
- Track connected listeners during nowPlaying.
- On end, if connected for >= 90% of duration, increment User.totalListens.
- Do not award tokens yet (Phase 3B).

Use server-side track end timer from Phase 0. Minimal frontend changes.
Show me example MongoDB documents after one full song.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 3A — Voting system

**Goal:** Level 2+ users vote 1–100 during a song; anonymous in UI; aggregates after song ends.

**Estimated time:** 3–5 days  
**Depends on:** Phase 2B

### Tasks

#### Backend

- Socket `vote:submit` — `{ playSessionId, score }` where score is 1–100
- Enforce: logged in, level ≥ 2, one vote per user per playSession
- Store in `Vote` collection
- Do not broadcast individual votes to room (keep anonymous)
- On song end: compute avg, high, low; save on `PlaySession`; update `Song` all-time stats
- Update DJ `avgScoreReceivedAsDj`; increment voter `votesGivenCount`
- Run level-up check after vote (Level 2 threshold)

#### Frontend

- Enable vote slider for Level 2+ only; show locked state for L1
- Submit vote on slider release (or your chosen UX)
- After song ends: show results panel (avg / high / low / vote count)
- Broadcast `vinyl:votePulse` on vote (no user id) for pit animation stub

### Exit criteria

- Level 1 user cannot vote (server rejects)
- Level 2 user can vote once; changing vote behavior matches your UX choice
- Second vote same song rejected
- Results appear after track ends; not tied to username in UI

### Cursor prompt — Phase 3A

```
Implement Phase 3A — Voting for ITV.

Backend:
- vote:submit socket handler with playSessionId and score 1-100.
- Require auth, User.level >= 2 (see permissions.js).
- One Vote per userId per playSessionId; reject duplicates.
- Do not emit who voted to other clients.
- On track end, aggregate votes onto PlaySession and Song all-time stats.
- Update DJ avgScoreReceivedAsDj and voter votesGivenCount.
- Check level-up rules for Member (L2) after vote.

Frontend:
- Enable vote slider for level >= 2; show message for level 1.
- Submit on slider release; show confirmation or subtle UI feedback.
- After song ends, display aggregate scores in the centre stage area.
- Emit/listen for vinyl vote pulse event (animation hook only).

Follow docs/WORKING-PLAN.md. No token grants yet.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 3B — Tokens & level progression

**Goal:** Token economy, shop, automatic level-ups, cosmetic unlocks.

**Estimated time:** 3–5 days  
**Depends on:** Phase 3A

### Tasks

#### Backend

- `TokenTransaction` model — userId, amount, reason, createdAt
- Grant +1 token on full listen (use 2B listen rule)
- Grant +3 tokens to DJ when their song finishes
- `GET /api/shop/items` — static or DB-driven catalog
- `POST /api/shop/purchase` — deduct tokens, apply cosmetic (vinyl border, username color, rank upgrade)
- `server/services/stats.js` — centralize token grant + level-up checks
- Level-up job triggers on vote, listen, play, account age

#### Frontend

- Token balance in nav
- `public/shop.html` — list items, purchase, show errors
- Apply purchased cosmetics in chat, vinyl pit, username display
- Level badge or label next to username (optional)

### Exit criteria

- Full listen grants +1 once per song per user
- DJ finish grants +3 once per play session
- Shop purchase deducts tokens and persists cosmetic
- User auto-promotes to L2/L3 when thresholds met
- TokenTransaction log exists for each change

### Cursor prompt — Phase 3B

```
Implement Phase 3B — Tokens & level progression for ITV.

Add TokenTransaction model and server/services/stats.js for:
- +1 token listener reward (90% listen rule from Phase 2B)
- +3 token DJ reward when their song finishes
- Idempotent grants (no double pay for same playSession)

Add GET /api/shop/items and POST /api/shop/purchase:
- Items: vinyl border, username color, optional level boost (configurable).
- Deduct tokenBalance; log TokenTransaction.

Auto level-up using server/config/levels.js thresholds.
Show token balance in nav; create shop.html matching site theme.
Apply cosmetics in vinyl pit and chat username styling.

Use docs/WORKING-PLAN.md thresholds unless noted in my message.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 3C — Staff roles & moderation

**Goal:** Resident, Host, Mod, Admin permissions enforced server-side.

**Estimated time:** ~1 week  
**Depends on:** Phase 2A (can run parallel with 3B after 3A)

### Tasks

#### Backend

- Admin routes: list users, set `staffRole`, adjust tokens (admin only)
- Mod: `mod:timeout`, `mod:kick`, `mod:clearChat` sockets
- Mod: `queue:modSkip` — skip any now-playing or queued track
- Host: `queue:priorityAdd` — insert at front of queue
- Host: `host:micToggle` — flag only (UI; WebRTC later)
- Resident: expose badges on profile; no extra mod powers unless you add them
- `ModAction` audit log (optional but recommended)
- Seed first admin user via script or env `BOOTSTRAP_ADMIN_EMAIL`

#### Frontend

- Admin panel: `public/admin.html` — user search, role dropdown, token adjust
- Mod tools on Online Users tab — timeout, kick
- Clear chat button for mod+
- Host: priority add button on playlist/queue UI
- Host: mic toggle (disabled / “Coming soon” until Phase 5)

### Exit criteria

- Non-mod cannot timeout or mod-skip
- Mod can timeout user (chat blocked for N minutes)
- Host priority add works; non-host rejected
- Admin can promote user to host/mod/resident
- All actions logged or auditable

### Cursor prompt — Phase 3C

```
Implement Phase 3C — Staff roles & moderation for ITV.

Use staffRole on User: null | resident | host | mod | admin.
Enforce all checks in server/config/permissions.js on socket handlers.

Add:
- admin.html + /api/admin/* routes (admin only): list users, set staffRole, adjust tokens.
- Mod sockets: timeout, kick, clearChat, modSkip song.
- Host sockets: priorityAdd to queue front, micToggle flag on session (no WebRTC yet).
- Bootstrap first admin via server script reading BOOTSTRAP_ADMIN_EMAIL from .env.

Frontend mod tools on Online Users list; host priority button; admin panel styled like existing site.
Reject unauthorized actions with clear error messages to client.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 4A — Vinyl Pit polish

**Goal:** Match master plan visuals — spinning vinyl, chat bounce, vote pulse — without killing mobile performance.

**Estimated time:** 3–5 days  
**Depends on:** Phase 3B (cosmetics), Phase 3A (vote pulse)

### Tasks

- Vinyl disc: avatar centered, spin animation, custom border from shop
- Hover tooltip: username, customSaying, badges, level
- Chat bounce: animate speaking user’s disc (throttle rapid messages)
- Vote pulse: all discs pulse on `vinyl:votePulse`
- Mobile: cap visible animated vinyls OR simplified static row — *your choice:*
- Load test with 20–30 connections (manual tabs or script)

### Exit criteria

- Pit reflects all online users with avatars
- Chat and vote animations work without exposing voter identity
- Acceptable FPS on your target phone

### Cursor prompt — Phase 4A

```
Implement Phase 4A — Vinyl Pit polish for ITV.

Enhance public/js/app.js and CSS:
- Spinning vinyl per online user with avatar in center and purchased border.
- Tooltip on hover: username, customSaying, badges, level name.
- Bounce animation when user sends chat (throttle to avoid jank).
- Pulse all vinyls on vote pulse socket event (anonymous).

Mobile performance: [DESCRIBE YOUR CHOICE — e.g. max 12 animated vinyls, rest static avatars].

Keep existing layout grid. Match void/purple theme.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 4B — Deploy & production hardening

**Goal:** Live on Render + MongoDB Atlas with secrets, HTTPS, and basic security.

**Estimated time:** 3–5 days  
**Depends on:** Phase 3C + 4A recommended before public launch

### Tasks

#### Infrastructure

- MongoDB Atlas cluster + database user + IP allowlist
- Set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` on Render
- Review/update `render.yaml`
- Custom domain + HTTPS (Render provides TLS)
- Choose Render plan: free (sleeps) vs paid (always on) — *your choice:*

#### Security & ops

- Rate limit auth routes and chat/vote sockets
- Validate all socket inputs server-side
- CORS locked to production origin
- Health check includes DB status
- Document backup / restore for MongoDB
- Graceful handling when server restarts mid-song

### Exit criteria

- Production URL loads Main Stage
- Register/login works on HTTPS
- Two real devices sync player/chat
- No secrets in repository
- You know how to promote first admin in production

### Cursor prompt — Phase 4B

```
Help me deploy ITV to production on Render with MongoDB Atlas.

Review render.yaml, server/index.js CORS, and .env.example.
Add:
- Rate limiting on /api/auth/* and chat/vote socket events.
- Health endpoint reporting db connected.
- Graceful restart behavior for room (document limitation or restore last play session).

Give me a step-by-step checklist for Atlas + Render env vars.
Do not commit secrets. Update README deploy section only if I confirm.
```

### Notes / changes I made

```
(your notes here)
```

---

# Phase 5 — Future (defer until core is stable)

Do not start until Phases 0–4B are done and you are happy with live usage.


| Feature                           | Complexity | Notes                                                      |
| --------------------------------- | ---------- | ---------------------------------------------------------- |
| WebRTC live mic + YouTube ducking | High       | Needs TURN/STUN or media server; duck via YT player volume |
| Mixlr upcoming shows              | Medium     | Embed widget or manual admin entries                       |
| In-house autoplay playlist        | Medium     | When queue empty; watch YouTube embed rules                |
| Leaderboard pages                 | Low        | Query Song + User aggregates                               |
| Email verification provider       | Medium     | Required if Level 2 gate is strict                         |
| Song history UI                   | Low        | `GET /api/history` + page                                  |
| Multiple playlists per user       | Medium     | Schema change                                              |


### Cursor prompt — Phase 5 (pick one feature)

```
Implement [FEATURE NAME] for ITV as described in docs/WORKING-PLAN.md Phase 5.

Constraints:
- Do not break existing auth, voting, or queue flow.
- Server-side permission checks for any privileged actions.
- Match existing UI theme.

Scope for this session: [NARROW SCOPE — e.g. leaderboard page only].
```

---

# Testing master checklist

Copy this when you finish each phase.


| Test                                        | Phase | Pass |
| ------------------------------------------- | ----- | ---- |
| Guest can still use Main Stage (if enabled) | 0, 2A | ☐    |
| Two tabs sync player within ~12s drift      | 0     | ☐    |
| Register + login two accounts               | 2A    | ☐    |
| Playlist persists after restart             | 2A    | ☐    |
| PlaySession created on song start           | 2B    | ☐    |
| totalListens only on full listen            | 2B    | ☐    |
| L1 blocked from voting                      | 3A    | ☐    |
| One vote per user per song                  | 3A    | ☐    |
| Scores shown after song ends                | 3A    | ☐    |
| Tokens grant correctly                      | 3B    | ☐    |
| Shop purchase works                         | 3B    | ☐    |
| Level auto-promotion                        | 3B    | ☐    |
| Mod timeout works                           | 3C    | ☐    |
| Host priority add works                     | 3C    | ☐    |
| Admin role assign works                     | 3C    | ☐    |
| Vinyl pit animations OK on mobile           | 4A    | ☐    |
| Production deploy login works               | 4B    | ☐    |


---

# Environment variables reference

```env
PORT=3000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=long-random-string-min-32-chars
CLIENT_ORIGIN=http://localhost:3000
BOOTSTRAP_ADMIN_EMAIL=you@example.com
# Optional later:
# YOUTUBE_API_KEY=
# EMAIL_PROVIDER_API_KEY=
```

---

# Troubleshooting prompts

### General debug

```
Something broke on ITV after my last change.

Symptom: [WHAT YOU SEE]
Expected: [WHAT SHOULD HAPPEN]
Phase I'm working on: [e.g. 3A]

Please inspect server logs flow, socket events, and relevant files.
Fix with minimal diff and give me verification steps.
```

### MongoDB connection

```
ITV cannot connect to MongoDB.

Error: [PASTE ERROR]
My MONGODB_URI is set in .env (do not print the URI).

Check server/config/db.js and startup in server/index.js.
Tell me what to fix in Atlas (IP allowlist, user permissions, connection string).
```

### Socket auth

```
Logged-in user on ITV is treated as guest / socket disconnects on login.

Check JWT in localStorage, socket handshake auth, and server socket middleware.
Fix public/js/app.js and server/sockets/index.js with minimal changes.
```

### Vote or token exploit

```
Review ITV for cheating vectors in voting and tokens.

Check: duplicate votes, disconnect/reconnect farming, double player:ended,
multiple tabs claiming listen rewards. Harden server-side in stats/vote handlers only.
Summarize fixes.
```

---

# Progress tracker


| Phase           | Status        | Started | Completed |
| --------------- | ------------- | ------- | --------- |
| 0 Foundation    | ☐ Not started |         |           |
| 2A Accounts     | ☐ Not started |         |           |
| 2B Play history | ☐ Not started |         |           |
| 3A Voting       | ☐ Not started |         |           |
| 3B Tokens       | ☐ Not started |         |           |
| 3C Staff/mod    | ☐ Not started |         |           |
| 4A Vinyl polish | ☐ Not started |         |           |
| 4B Deploy       | ☐ Not started |         |           |
| 5 Future        | ☐ Deferred    |         |           |


---

*Last updated: fill in when you edit this plan.*