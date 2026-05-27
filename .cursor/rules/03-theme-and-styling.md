---
description: ITV visual identity, CSS tokens, layout grid, components, and responsive rules
alwaysApply: true
---

# INTO THE VOID — Theme & Styling

## Visual identity

**Aesthetic:** Dark void / black hole — deep blacks, purple glow, muted greys. Accents: purple (primary), flame orange (highlights), teal success, red danger. Branding may use skulls/flames; UI stays clean and readable.

**Mood:** Underground club / community radio — not corporate SaaS, not bright/light mode.

**Never** introduce a light theme, Bootstrap, Tailwind, or unrelated font stacks unless the user explicitly requests it.

## CSS architecture

Load order on every page:

```html
<link rel="stylesheet" href="/css/variables.css" />
<link rel="stylesheet" href="/css/layout.css" />
<link rel="stylesheet" href="/css/components.css" />
```

| File | Responsibility |
|------|----------------|
| `variables.css` | Design tokens only (`:root` custom properties) |
| `layout.css` | Page structure, grid, nav, stage, panels, vinyl pit shell |
| `components.css` | Buttons, forms, chat, playlist rows, modals, vinyl discs |

**Add new tokens to `variables.css`** — do not hardcode hex values in components when a token exists or should exist.

## Design tokens (`variables.css`)

```css
--void-black: #050508;
--void-deep: #0e0c14;
--void-panel: #14121c;
--void-border: #2a2640;
--purple-bright: #9b5de5;   /* links, primary glow, active states */
--purple-mid: #7b2cbf;
--purple-dim: #5a189a;
--grey-text: #b8b8c8;       /* body text */
--grey-muted: #6b6b80;      /* secondary / placeholders */
--flame: #ff6b35;           /* accents, highlights */
--danger: #e63946;
--success: #2ec4b6;
--font-display / --font-body: "Segoe UI", system-ui, sans-serif;
--radius: 8px;
--shadow-glow: 0 0 24px rgba(155, 93, 229, 0.25);
--side-panel-width: 312px;
--vinyl-pit-height: 220px;
--player-max-width: 420px;
--player-max-height: 236px;
--void-bg-base: #030304;
--scrollbar-track: #3a1458;
--scrollbar-thumb: #ffffff;
```

When adding cosmetics (shop vinyl borders, username colors), prefer **CSS classes + data attributes** backed by user profile fields — not inline styles from unvalidated user input.

## Global page treatment

- `html, body`: `height: 100%`, `overflow: hidden` on Main Stage (fixed viewport app).
- Body background: layered **radial gradients** on `--void-bg-base` — subtle purple haze (`body::before`), no busy patterns.
- Scrollbars: thin, purple track, white thumb — match existing webkit + `scrollbar-color` rules.
- Links: `--purple-bright`, underline on hover.

Marketing pages (`home.html`, `about.html`) use `.page-main` with normal scroll; Main Stage uses `.stage` grid.

## Main Stage grid (`layout.css`)

```
┌─────────────────────────────────────────────────────────┐
│ site-nav                                                │
├──────────┬──────────────────────────────┬───────────────┤
│ playlist │   centre (video + controls)  │  chat tabs    │
│  panel   │                              │   panel       │
├──────────┴──────────────────────────────┴───────────────┤
│              vinyl-pit (full width)                     │
└─────────────────────────────────────────────────────────┘
```

- `.stage` — CSS grid; side panels `--side-panel-width`; bottom row `--vinyl-pit-height`.
- `.panel` — `--void-panel` background, `--void-border` border, `--radius`, optional `--shadow-glow` on focus areas.
- `.panel-header` — uppercase-ish labels, muted; actions use `.btn-ghost.btn-sm`.

**Do not** collapse the vinyl pit into a side panel or move chat below the pit without explicit user approval.

## Navigation

- `.site-logo` — **INTO THE VOID** wordmark area.
- `.nav-links` — Home, About Us, Main Stage; `.active` on current page.
- `.nav-user` — display name / avatar / login; use `.link-btn` for text actions (e.g. Change name).

## Components (`components.css`)

### Buttons

| Class | Use |
|-------|-----|
| `.btn-primary` | Main actions (Add, Join, Submit) — purple fill/glow |
| `.btn-ghost` | Secondary (Rip, panel actions) |
| `.btn-sm` | Compact panel buttons |
| `.link-btn` | Text button in nav / inline |

Hover: subtle brighten or glow — no jarring color jumps.

### Forms

- Inputs: dark fill (`--void-deep`), `--void-border` border, focus ring purple.
- Placeholders: `--grey-muted`.
- Playlist URL input + Add button in `.playlist-form` row.

### Chat

- Messages: display name + text; escape HTML on render.
- Distinct but subtle differentiation for system/mod messages when added.
- Scrollable `.chat-scroll` inside panel body.

### Playlist rows

- Thumbnail, title, reorder (↑↓), remove.
- Drag or buttons — match existing `app.js` behaviour.

### Modals

- `#name-modal` pattern: `.modal` + `.modal-card`, `.hidden` toggle.
- Centre on screen, panel styling, primary button for confirm.

### Media controls

- Centre column transport row: Join Queue, Leave, Skip, etc.
- Icon or label buttons consistent with ghost/primary hierarchy.
- **Vote block:** range input + numeric display; disabled state for Phase 1 / Level 1 users (greyed, label explains why).

## The Vinyl Pit

- Container: `#vinyl-pit` inside `.vinyl-pit` panel — full width, fixed height `--vinyl-pit-height`.
- Each user: `.vinyl-user` with `.vinyl-disc-small` (or enhanced spinning disc in Phase 4A).
- Avatar image **centered** on disc (when auth exists).
- Tooltip/hover: username, `customSaying`, badges, level — do not clutter the disc face.
- Animations:
  - **Spin** — continuous slow rotation (CSS `@keyframes`).
  - **Bounce** — on chat from that user (throttle rapid messages).
  - **Pulse** — all discs on anonymous vote event.
- **Mobile / performance:** cap animated discs or simplify to static avatars if FPS drops; never block layout on pit render.

## YouTube player area

- `#yt-player` wrapper constrained by `--player-max-width` / `--player-max-height`.
- `#player-idle` overlay when nothing playing — hidden when `player:sync` has `videoId`.
- DJ banner above/below player: current DJ name + track title from `room:state` / `player:sync`.

## Typography & spacing

- Body: `--grey-text`, `line-height: 1.5`.
- Headings on marketing pages: display font token; Main Stage relies on panel headers more than h1.
- Consistent padding inside `.panel-body`; use existing gap/padding scale from layout.css.

## Responsive rules

Main Stage must work on **desktop, tablet, and mobile** (project requirement).

Existing breakpoints in `layout.css` — extend, do not replace blindly:

- Narrow viewports: side panels may stack or shrink; **centre video remains priority**.
- Vinyl pit stays visible but may reduce disc size/count.
- Touch targets ≥ 44px where possible for queue/chat controls.
- Avoid horizontal overflow on chat and playlist.

Test at ~375px width before marking UI work complete.

## Accessibility baseline

- Modal: `role="dialog"`, `aria-labelledby`.
- Buttons: `type="button"` unless submit.
- Form inputs: associated `<label>` or `aria-label` where missing.
- Vote slider: `<label for="vote-slider">`.
- Do not rely on color alone for errors — include text (`.error`, toast, or ack error message).

## New pages (login, settings, shop, admin)

- Reuse **same nav header** pattern as `home.html`.
- Same CSS load order and tokens.
- `.page-main` for form-heavy pages; max-width content column centred.
- Shop/admin: card grid using `.panel` styling for items.

## Anti-patterns

- No white backgrounds, no default browser grey buttons.
- No random fonts (Inter, Roboto, Arial-only) without updating tokens.
- No inline `style=""` except dynamic JS positioning when unavoidable.
- No stock “bootstrap blue” primary buttons.
- No emojis in UI copy unless user asks.

## Quick checklist for UI changes

- [ ] Uses tokens from `variables.css`
- [ ] Matches panel/button/chat patterns in `components.css`
- [ ] Main Stage grid intact (nav / sides / centre / pit)
- [ ] Readable contrast on `--void-panel`
- [ ] Mobile width checked
- [ ] Chat/user content escaped before `innerHTML`
