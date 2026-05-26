# INTO THE VOID (ITV)

Phase 1: live room with YouTube player, chat, personal playlists, and shared DJ queue. No login yet (display name only).

## What you need

- **Node.js 18+** — [https://nodejs.org](https://nodejs.org) (LTS)
- After install, restart Cursor and confirm in a terminal:

  ```powershell
  node -v
  npm.cmd -v
  ```

  On Windows PowerShell, use **`npm.cmd`** instead of `npm` if you see a “running scripts is disabled” error (see Troubleshooting).

## Run the site (every time you work on it)

### Easiest (Windows): double-click or run batch files

1. First time only: double-click **`install.bat`** in this folder.
2. Every session: double-click **`start.bat`**, then open http://localhost:3000/home.html

### Or use the terminal

1. Open a terminal in this folder (`ITVLIVE`).
2. Install dependencies (first time only):

   ```powershell
   npm.cmd install
   ```

3. Start the server:

   ```powershell
   npm.cmd start
   ```

4. Open in your browser:

   - **Home:** http://localhost:3000/home.html
   - **Main Stage:** http://localhost:3000/index.html
   - **Health check:** http://localhost:3000/health

5. Stop the server: press `Ctrl+C` in the terminal.

### Optional: auto-restart when you edit server files

```powershell
npm run dev
```

## Project layout

```
ITVLIVE/
├── public/          ← HTML, CSS, JS (what users see)
├── server/          ← Node + Express
├── package.json
└── .env.example     ← copy to .env when you add MongoDB later
```

## Phase 1 — how to use the Main Stage

1. Run the server (`start.bat` or `npm.cmd start`).
2. Open **http://localhost:3000/index.html**
3. Enter a display name when prompted.
4. **Playlist (left):** paste a YouTube URL → Add. Use ↑↓ to reorder.
5. **Join queue:** press ▶ — your top playlist song enters the global DJ queue.
6. **Chat (right):** type and Send. Open a **second browser tab** (or Incognito) with another name to test live updates.
7. **Controls:** ⏩ leave queue · ⏹ skip now playing (only if you are the current DJ) · ⏪ remove your waiting song · **Rip** adds the current track to your playlist.

Votes and token shop arrive in Phase 2–3. Accounts/MongoDB in Phase 2.

## Next phases (later)

| Phase | What gets added |
|-------|-----------------|
| 2 | Accounts, MongoDB, login, saved playlists |
| 3 | Voting, tokens, Vinyl Pit cosmetics |
| 4 | Deploy to Render + MongoDB Atlas |

## Troubleshooting

### `npm.ps1 cannot be loaded` / scripts disabled (PowerShell)

PowerShell is blocking `npm.ps1`. Use any of these:

1. **Use `npm.cmd` instead of `npm`** (recommended):

   ```powershell
   npm.cmd -v
   npm.cmd install
   npm.cmd start
   ```

2. **Use Command Prompt** in Cursor: Terminal menu → **New Terminal** → dropdown → **Command Prompt**, then `npm install` works normally.

3. **Use the `.bat` files** in this folder (`install.bat`, `start.bat`) — they call `npm.cmd` for you.

4. **Optional policy fix** (only if your PC allows it — not blocked by work/school policy):

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

   Then close and reopen the terminal. If you get “overridden by a more specific scope,” stick with `npm.cmd` or Command Prompt.

| Problem | Try |
|---------|-----|
| `npm` not recognized | Reinstall Node from nodejs.org; add `C:\Program Files\nodejs` to PATH |
| `npm.ps1` / scripts disabled | Use `npm.cmd` or `start.bat` (see above) |
| Port 3000 in use | Set `PORT=3001` in a `.env` file |
| Page looks unstyled | Use `http://localhost:3000/...` not double-clicking HTML files |
| Add / Chat do nothing | Old server still running — **Ctrl+C** in that terminal, then `npm.cmd start`. Check http://localhost:3000/health shows `"phase":1` |
