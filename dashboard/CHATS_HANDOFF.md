# Chats UI Redesign — Project Handoff

This document exists because this project has burned ~25 commits cycling on the same redesign without the previous Claude sessions ever rigorously proving the result looked different. Read all of it before touching code. Do not skip Section 5 and Section 6.

---

## 1. Project Overview

**What this is:** OpenWA — a self-hosted WhatsApp API gateway (NestJS backend) with a bundled React admin dashboard. It exposes WhatsApp session management, messaging, webhooks, contacts, and an Omega SaaS layer (separate multi-tenant admin layer at `/omega`), all behind API-key auth.

**Backend stack:** NestJS (TypeScript), TypeORM, SQLite (dev) or Postgres (prod), optional Redis/BullMQ for queueing, optional S3/MinIO for media storage. WebSocket gateway (Socket.IO via `@nestjs/websockets`) pushes live events (`message.received`, `message.sent`, `message.ack`, etc.) per session.

**Frontend stack:** React + TypeScript + Vite, plain CSS (no Tailwind/CSS-in-JS), `lucide-react` icons, `react-i18next` for translations. Built output is bundled and served by NestJS itself at the root path — there is no separate dashboard server in production.

**WhatsApp engine:** Pluggable engine layer (`src/engine/adapters/`). Two adapters exist:
- `whatsapp-web.js` (Puppeteer/Chromium-based, default) — requires reaching `web.whatsapp.com`, scanning a QR code, real internet access.
- `baileys` (WebSocket-based, no Chromium) — also requires real WhatsApp network access.
**Neither engine can be authenticated in this sandboxed dev environment** (outbound network to WhatsApp is blocked here). This has architectural consequences — see Section 11.

**Docker setup:** `docker-compose.dev.yml` runs the whole stack (API + bundled dashboard) as one NestJS container on port 2785, SQLite with `DATABASE_SYNCHRONIZE=true`. There is no separate dashboard container — the dashboard is built into `dist/` and served statically by Nest.

**Current deployment method:** Single container, `node dist/main.js` (or `npm run start:prod`), dashboard pre-built via `npm run dashboard:build` and bundled into the same image.

**Current branch:** `claude/sweet-cannon-q8e6nf`

**Production status:** Not deployed anywhere known to this session. This is active development on a feature branch. The base/default project branch is presumably `main` (not verified in this session — check before assuming).

**Important folders:**
- `dashboard/src/pages/Chats.tsx` — the whole Chats page (chat list + conversation + composer + info panel), ~1300 lines.
- `dashboard/src/pages/Chats.css` — all Chats styling, ~2600 lines.
- `dashboard/src/components/chats/` — extracted sub-components: `ChatRow.tsx`, `ConversationHeader.tsx`, `Composer.tsx`, `DateSeparator.tsx`, `InfoPanel.tsx`, `MediaCard.tsx`, `MessageBubble.tsx`, `ReplyCard.tsx`, `helpers.tsx`, `types.ts`, `index.ts`.
- `src/modules/session/` — backend session lifecycle, `getChats()`, `getChatsFromStoredMessages()` fallback, `sendSeen`, `deleteChat`.
- `src/modules/message/` — `Message` entity and message persistence/service.
- `src/engine/adapters/` — WhatsApp engine adapters.

**Important files:**
- `.env.minimal` — the dev-friendly env template (SQLite, no Redis, no S3). Use this as the base `.env` for any local dev/testing.
- `.env.example` — full documented env reference (Postgres, S3, webhooks, security, Omega layer, etc.).
- `package.json` (root) — `build:all` runs `nest build && npm run dashboard:build`; `dashboard:build` is `cd dashboard && npm run build` (tsc -b && vite build).

---

## 2. Current Goal

Make the Chats page **look and feel like a premium WhatsApp Desktop / Apple "Liquid Glass" client**, not an admin-dashboard CRUD table that happens to show messages. Concretely:

- **Premium WhatsApp Desktop experience**: dense but legible 3-pane layout (icon rail / chat list / conversation, optional 4th info pane), real avatar circles, real message bubbles with tails/grouping, not bordered "cards."
- **Apple Liquid Glass design language**: translucent blurred surfaces (`backdrop-filter: blur(...)`), soft shadows, rounded corners, light/dark theme parity, subtle motion — not flat Bootstrap-style panels.
- **Support Inbox workflow**: this is a *support agent* tool, not a personal WhatsApp clone — channel/workspace selector, unread badges, search, multi-channel filter, "Open" status chips. The visual style should borrow from WhatsApp Desktop, but the workflow is inbox triage, not 1:1 personal chat.
- **Media handling**: inbound media (images, docs, voice notes, stickers) should render as a recognizable placeholder with **on-demand, click-to-download** behavior — not auto-fetch every blob on page load (cost/perf reasons).
- **Chat history**: full scrollback with date separators, "load older" on scroll-up, smart auto-scroll-to-bottom that doesn't fight the user when they've scrolled up to read history.
- **Responsive behaviour**: degrade gracefully on narrower viewports — info panel becomes a drawer/overlay, chat list can collapse — never tested rigorously yet (see Section 4).
- **Performance goals**: no goal has been formally set or measured (no virtualization, no profiling done). This is unfinished work, not a completed goal.

---

## 3. Completed Work

In rough chronological order (oldest → newest), confirmed by `git log`:

- `e0ef06e` Avoid endless chat loading on stalled requests (reliability fix).
- `885beb7` Theme-aware scrollbars for dark mode.
- `46ac8e7` Multi-channel chat filter (select multiple session/workspace accounts, merge their chats into one list).
- `1db8ef5` → `030aedb` → `7cdf472` → `f5691e4` — early density/polish passes on the chat panel (CSS-only), added presentational info button and a disabled "future mic button" placeholder (this placeholder pattern later became the template used to fix the Phone/Video buttons — see latest commit).
- `750fe17` WhatsApp-style message rendering: stickers, documents, voice notes, quoted/reply previews, links.
- `62b81ba` Chat reliability: composite message identity (dedupe), race guards on concurrent fetches, "load older" pagination, failed-channel notice banner.
- `e461bd8` Added a Chat Info drawer (v1, in-memory only, no persistence).
- `f78e559` More reliability: offset-based pagination, accurate totals, smart auto-scroll, pure state updater function, mobile drawer behavior for the info panel.
- `86178d0` → `410f7c6` → `80065f9` → `ea954b4` → `c930eb8` — **first wave of "premium redesign" attempts**: icon rail + list + conversation layout rebuild, replaced a CSS `zoom` hack with real sizing, tuned column widths (280px list) and row heights (68px) and bubble max-width (72%).
- `ebf6f1a` Introduced `--chat-*` CSS custom properties for light/dark theme tokens (fixed contrast bugs).
- `965a1c0` Full chat history loading + on-demand (click-to-download, non-auto) media download — this is real, functional behavior, not just CSS.
- `e111d00` → `3fe5a0c` → `4fb714a` → `5985cdd` — **second wave of "premium redesign" attempts**: rebuilt the inbox into a WhatsApp-Desktop-style list, consolidated previously scattered/duplicated message-bubble CSS rules into one authoritative section, then a full pass described as "Liquid Glass" redesign.
- `084c6e7` (latest, this session) — Fixed a real defect found during verification: the header's Phone/Video call buttons had no `onClick` handler at all (dead placeholder controls). Disabled them with `title="...coming soon"` + `aria-label` + a dimmed `:disabled` style matching the existing `.btn-mic-future` pattern. **Verified via real Playwright DOM inspection** that `disabled: true` and computed `opacity: 0.35` actually apply in the rendered app — not just code-reading.

**The one thing genuinely verified end-to-end this session** (see Section 11 for method): booted the real server, created a real session row, seeded real rows into the `messages` SQLite table, logged into the real dashboard with a real (dev) API key, and loaded the real `/chats` route in a real Playwright-driven Chromium against `localhost:2785` — not a static HTML mockup. Screenshots were taken of the conversation, header, composer, info panel, in both light and dark theme, confirming the current CSS renders as intended in the actual app shell (sidebar nav, real WebSocket connection, real data).

---

## 4. Remaining Work

Be skeptical of any claim that this page is "done." It is not.

**UI**
- No before/after comparison screenshot pair exists in the repo or in any commit message — every "redesign complete" claim in git history is asserted, not demonstrated.
- Chat list row density (68px), bubble max-width (72%), and column widths (280px) were "tuned" by feel, not validated against real WhatsApp Desktop measurements or a real support-inbox content load (long names, long snippets, emoji, RTL text).
- No virtualization on the chat list or message list — with a real, busy support inbox (hundreds of chats, thousands of messages) this will jank.

**UX**
- Search (`chat-search-input`) exists in the chat list toolbar but conversation-level search (the `Search` icon in `ConversationHeader.tsx`, wired via `onSearchClick`) — confirm whether it actually opens a working in-conversation search UI or is another silent no-op. **Not verified this session.**
- "More options" (`MoreVertical` button, `onMoreClick`) — same concern, not verified.
- Multi-channel filter (`46ac8e7`) interaction with the redesigned list has not been re-tested since the later visual passes.

**Backend**
- `getChats()` falls back silently to `getChatsFromStoredMessages()` whenever the live engine call fails or times out (15s timeout, see `session.service.ts`). This means **a session that has never successfully connected to real WhatsApp will silently show stale/fake-looking data with no UI indication that it's a fallback, not live state.** This is a real correctness gap, not just a dev-environment workaround — worth flagging to product/eng, not just papering over.

**Media**
- Only verified that a media placeholder renders and a download button exists (`MediaCard.tsx` / `media-download-btn`). Never verified an actual click-to-download round-trip against a real media-bearing message, because no real WhatsApp session was available to produce one. **This is untested, not done.**

**Message rendering**
- Stickers, documents, voice notes, quoted replies were implemented in `750fe17` (CSS/markup) but never re-verified against the latest "Liquid Glass" CSS pass — possible visual regressions from later global CSS changes (`4fb714a` claims to have consolidated "scattered, duplicate" bubble CSS, which strongly suggests there *were* conflicting selectors fighting each other before that commit — and no audit confirms none remain elsewhere in the 2600-line file).

**Search:** conversation-level search not confirmed wired (see UX above).

**Performance:** no profiling, no virtualization, no measurement of WebSocket message volume handling under load.

**Accessibility:** spot-checked `aria-label`/`title` on action buttons this session (good baseline), but no screen-reader pass, no keyboard-navigation pass through the chat list/composer/emoji picker, no color-contrast audit of the new glass surfaces in either theme.

**Responsive:** "info panel becomes a drawer on mobile" was claimed in `f78e559` but not re-verified after the later full CSS redesign passes. No real device/viewport matrix has ever been tested in this project's history as far as commit evidence shows.

**Animations:** "Liquid Glass" implies motion (panel open/close transitions, message arrival animation, etc.) — current state has, at most, CSS transitions on hover (`room-action-btn` transition, etc.). No deliberate motion design has been verified.

---

## 5. Biggest Mistakes Made During This Project

Read this section as a list of **anti-patterns to actively avoid**, not history trivia.

1. **Claimed redesigns that were not visually substantiated.** Commits like `ea954b4` ("Premium Liquid Glass redesign"), `3fe5a0c` ("Make Chats UI visibly WhatsApp Desktop + Apple glass"), and `5985cdd` ("Redesign Chats into a premium WhatsApp/iMessage client with real Liquid Glass") were committed without any screenshot evidence attached to the commit, and — critically — without the only verification method that matters: opening the *real, running application* and looking at it. Repeating the word "premium" or "real Liquid Glass" in a commit message is not evidence of anything.

2. **Built and tested against a static HTML preview harness instead of the actual React app.** Earlier in this session (before this handoff), a static `preview.html` file was constructed by hand, with `chats-page`/`chat-item-card`/`message-bubble` markup typed out manually to mimic what the component *should* render, and Playwright screenshots were taken **of that fake file**, not of the real app. This is actively dangerous: it proves the CSS *can* produce a nice look for hand-written markup, while saying nothing about whether the actual `ChatRow.tsx`/`MessageBubble.tsx`/`Composer.tsx` components — with their real class names, real conditional rendering, real data shapes — produce that same look. The user explicitly called this out and rejected it as a verification method.

3. **Claimed "Apple Glass" while the UI still looked like an admin dashboard.** Multiple early commits (`86178d0`, `410f7c6`) describe layout reorganization in dashboard/SaaS terms ("density," "hierarchy," "flatter surfaces") — the language of enterprise admin panels, not consumer chat apps — while simultaneously claiming a consumer-chat aesthetic. The mismatch between the words used to describe the work and the actual visual target is itself a sign the work wasn't being checked against the target.

4. **Added placeholder buttons with no behavior.** The `ConversationHeader.tsx` Phone/Video call buttons were added with no `onClick` at all — they looked clickable but did nothing if clicked. This was caught and fixed *only* in this session (`084c6e7`), and only because it was explicitly checked for, not because it was caught during the original implementation. The earlier `f5691e4` "future mic button" was actually done correctly (disabled + labeled) — the project had the right pattern available and simply didn't apply it consistently.

5. **Created duplicate/competing CSS, requiring a dedicated cleanup commit.** `4fb714a` — "Consolidate scattered message-bubble CSS into one final authoritative section" — is a confession that, at some point, multiple selectors targeting the same elements were written in different places in `Chats.css` and were fighting each other (or silently relying on source order to "win"). This happens when CSS is appended at the end of a growing file instead of integrated into the relevant existing section, and when nobody periodically audits for duplicate selectors.

6. **Tiny typography, tiny avatars, tiny bubbles, card-based inbox rows, weak visual hierarchy, cold admin palette — all needed multiple dedicated "fix the look" commits to address** (`c930eb8` tuning 280px/68px/72%, `ebf6f1a` fixing contrast tokens, the entire `e111d00`→`5985cdd` second wave). The pattern: ship something dashboard-shaped, get told it doesn't look like a chat app, do a partial fix, ship again, repeat. This is the single biggest time sink in the project's history — at least 8 commits are dedicated to re-attempting the same "make it look like a real chat app" goal.

7. **Didn't compare before/after.** No commit in this entire history includes a side-by-side or sequential before/after screenshot. Without that comparison, "is this actually different" is being judged by code-reading and memory, which is exactly how the same mistake (looks like a dashboard) got repeated across multiple "redesign" commits.

8. **Didn't verify against the running application** until explicitly forced to in this session. Every prior "redesign complete" commit was made without ever loading the real Vite/Nest-served app in a browser and looking at it with real data flowing through the real API.

9. **Over-reported completed work.** Words like "complete," "premium," "real," "final" appear repeatedly in commit messages for what were, by the project's own later commits, incomplete or insufficient attempts (proven by the fact that further "redesign" commits kept being needed afterward).

10. **Repeated previous mistakes after (implicitly) being told not to.** The fact that *two separate full redesign waves* exist (`86178d0`...`c930eb8`, then `e111d00`...`5985cdd`) for the *same stated goal* ("WhatsApp Desktop + Apple Glass") is direct evidence that the first wave's "done" claim was wrong, and that the lesson — verify before claiming done — was not applied the second time either, only forced in this session via the placeholder-button fix.

---

## 6. Rules For The Next Claude Session

This is a strict checklist. Treat every item as a hard gate before any commit that touches `Chats.tsx`, `Chats.css`, or `components/chats/*`.

- [ ] **Never claim a redesign is complete without screenshots** taken from the real running app, attached/referenced in your response to the user (not just taken and discarded).
- [ ] **Always compare old vs new UI** — take a screenshot of the current state *before* making changes, then after, and look at both side by side before claiming anything changed for the better.
- [ ] **Test in the running application** — `node dist/main.js` (or `npm run start:prod` after `npm run build:all`) serving the real bundled dashboard, accessed via a real browser (Playwright against `http://localhost:2785`, not a file:// path).
- [ ] **No preview harnesses.** Never hand-write a static HTML mockup of what a component "should" render and screenshot that instead of the real component. If you need to see a component in isolation, render it through the real app's routing, not a hand-authored copy of its markup.
- [ ] **No placeholder controls.** Every button must either do something real, or be `disabled` with a `title`/`aria-label` that honestly says it's not implemented yet (follow the `.btn-mic-future` pattern already established in `Composer.tsx`).
- [ ] **No duplicate CSS.** Before adding a new rule for a selector, `grep` `Chats.css` for that selector first. If it already has rules elsewhere, edit those — don't append a second competing block.
- [ ] **Don't refactor unless it changes UX.** Component extraction, CSS consolidation, etc. are not goals in themselves — only do them when they're necessary to ship a real, verified visual/behavioral change, or when explicitly asked.
- [ ] **Every commit must create an obvious visual improvement** — obvious enough that you could show a stranger the before/after screenshots and they'd immediately see the difference without it being pointed out. If you can't articulate the visual difference in one sentence, it isn't obvious enough.
- [ ] **Build before commit** — `npm run build:all` (root) must succeed.
- [ ] **Typecheck before commit** — `npx tsc --noEmit` (root) and ideally `cd dashboard && npx tsc -b --noEmit` for the dashboard project; check for *new* errors only (there are 2 known pre-existing unrelated spec-file errors as of `084c6e7` — `contact.service.spec.ts` and `infra.controller.spec.ts` — don't treat those as yours, but don't let that excuse become a habit either).
- [ ] **Test responsive layouts** — at minimum check a narrow viewport (≤768px) and confirm the info panel/chat list degrade as intended, with a real screenshot, not an assumption.
- [ ] **Verify both themes** — light and dark, via the app's actual theme toggle/localStorage key (`openwa_theme` in `useTheme.ts`), not by guessing CSS variable values.
- [ ] **Compare against current WhatsApp Desktop** — actually look at a current WhatsApp Desktop screenshot/reference when making layout/density/typography decisions, don't design from memory alone.

---

## 7. Design Specification

This section describes the *intended* end state. Treat gaps between this and reality as the backlog (Section 4 has specifics).

**Layout** — 3 (or 4, when info panel open) column shell:
1. Icon rail (~64–72px): logo glyph, nav icons with unread-count badges, online-status dot at the bottom.
2. Chat list / inbox (~280px): workspace/channel selector, channel filter, search input, status chips (e.g. "Open"), then the scrollable list of `ChatRow`s.
3. Conversation pane (flexible width, fills remaining space): `ConversationHeader`, scrollable `room-messages` with `DateSeparator`s and `MessageBubble`s, then `Composer` pinned to the bottom.
4. Optional `InfoPanel` (~280–320px), slides in from the right when "Chat info" is toggled — contact identity, phone number, stats (in/out/media counts), not persistent unless explicitly toggled open.

**Spacing** — dense but not cramped: chat list rows ~68px tall; message bubbles grouped tightly (no meta repeated) when consecutive from the same sender within a short time window, with a slightly larger gap between distinct groups/senders.

**Typography** — system font stack (`-apple-system, "Segoe UI", Roboto, sans-serif` or equivalent), legible body text (~14–15px) for messages, slightly smaller (~12–13px) for timestamps/secondary text, semibold for contact names. Avoid the "tiny text everywhere" admin-dashboard failure mode called out in Section 5.

**Header (`ConversationHeader.tsx`)** — avatar with online-status ring/dot, contact name (h3-weight), single status line (online/typing-equivalent + Direct/Group), right-aligned icon button cluster: search, info (toggleable `active` state), more-options, and the two **disabled** call buttons (already correctly disabled as of `084c6e7` — keep them disabled until calling is actually implemented, do not silently re-enable them without wiring real behavior).

**Conversation** — incoming bubbles left-aligned with one tail style/color, outgoing right-aligned with a distinct accent color (WhatsApp-green-style accent is consistent with the existing `--chat-accent` token usage), read/delivered ticks on outgoing messages only, quoted-reply preview boxes rendered above the quoting message's text, media messages shown as a placeholder card with explicit click-to-download (never auto-fetch).

**Composer (`Composer.tsx`)** — attachment, emoji, single-line text input (Enter to send, Shift+Enter reserved for a future multi-line case — currently a no-op since it's an `<input>` not `<textarea>`, documented honestly in code comments), disabled mic-placeholder, send button. Attachment preview banner and reply-preview banner render directly above the composer when active. Emoji picker renders as a floating grid above the composer when toggled.

**Chat list (`ChatRow.tsx`)** — avatar (Users icon for groups, User icon for 1:1), name + relative/absolute time on the top line, last-message snippet + unread badge on the bottom line, search-term highlighting via `highlightMatch`, active/selected state with a left accent or background tint (not a bordered "card" — this was explicitly called out as a regression pattern to avoid in Section 5).

**Info panel (`InfoPanel.tsx`)** — identity block (avatar, name, Direct/Group type tag), phone number section, statistics grid (in/out/media counts), close button.

**Glass / blur / shadows** — translucent panel backgrounds using `backdrop-filter: blur(...)` over a soft gradient/tinted background, subtle drop shadows on raised surfaces (message bubbles, floating emoji picker, attachment preview banner), rounded corners throughout (panels, bubbles, avatars are circular).

**Colors** — theme-token-driven via `--chat-*` CSS custom properties introduced in `ebf6f1a` (e.g. `--chat-text`, `--chat-text-secondary`, `--chat-accent`, `--chat-accent-soft`, `--chat-button-hover`) — both light and dark values must be defined for every token used; never hardcode a color directly in a component-level rule when a token exists.

**Icons** — `lucide-react`, consistent sizing per context (header actions 18px, avatars 20–21px, composer actions 18–20px) — check `ConversationHeader.tsx`/`Composer.tsx` for the established sizes before introducing new icon usages with different sizing.

**Hover / selection / focus states** — hover: subtle background tint (`--chat-button-hover`); active/selected: accent-tinted background + accent text/icon color; focus-visible: 2px accent outline with offset (already implemented on `.room-action-btn`, replicate this pattern for any new interactive element — don't skip focus-visible styling).

**Animations / motion** — currently minimal (hover transitions only). Not yet designed. If asked to add motion, keep it subtle: panel slide-in/out for the info drawer, gentle fade/slide for new messages arriving, no gratuitous bounce/spring effects that would look out of place next to WhatsApp Desktop's actual restrained motion language.

---

## 8. Technical Constraints

Do **not** change these without an explicit, separate request — they are out of scope for "redesign the Chats UI":

- **Backend API contracts** — `src/modules/session/session.controller.ts` and `session.service.ts` routes (`/sessions/:id/chats`, `/sessions/:id/messages`, `/sessions/:id/chats/read`, `/chats/delete`, `/chats/typing`, etc.) and their response shapes (`ChatSummary`, message DTOs).
- **OpenWA engine adapters** (`src/engine/adapters/`) — `whatsapp-web.js` and `baileys` integration logic.
- **Database schema** — `Session` and `Message` TypeORM entities (`src/modules/session/entities/session.entity.ts`, `src/modules/message/entities/message.entity.ts`). Any schema change needs a migration, not a quick edit, and is well outside a UI redesign's scope.
- **WebSocket architecture** — `EventsGateway`, the per-session event subscription model (`session:<id>:message.received` etc.).
- **Authentication** — API-key (`X-API-Key`) auth flow, `dev-admin-key`/`ALLOW_DEV_API_KEY` dev-only mechanism, Omega layer's separate auth.
- **Session management lifecycle** — start/stop/QR flow, `engines` in-memory map semantics in `SessionService`.
- **Message sending logic** — `MessageService`, send/ack/status update flow.
- **Docker networking / compose files** — `docker-compose.dev.yml` and friends.

If a UI change *seems* to require touching one of these, stop and flag it explicitly rather than quietly editing backend code "to make the screenshot look right."

---

## 9. Files That Matter

| File | Purpose |
|---|---|
| `dashboard/src/pages/Chats.tsx` | Top-level Chats page: state management, data fetching/polling, WebSocket subscription wiring, orchestrates all sub-components below. |
| `dashboard/src/pages/Chats.css` | All styling for the Chats page and its sub-components — single large stylesheet, theme tokens live here. |
| `dashboard/src/components/chats/ChatRow.tsx` | Single chat-list row (avatar, name, snippet, time, unread badge). |
| `dashboard/src/components/chats/ConversationHeader.tsx` | Top bar of the open conversation (avatar, name, status, action buttons). |
| `dashboard/src/components/chats/Composer.tsx` | Bottom input bar (attachment, emoji, text input, mic placeholder, send) + attachment/reply preview banners + emoji picker. |
| `dashboard/src/components/chats/MessageBubble.tsx` | Individual message rendering (text, media, quotes, status ticks). |
| `dashboard/src/components/chats/ReplyCard.tsx` | Quoted-message preview rendered inside a bubble or the composer's reply banner. |
| `dashboard/src/components/chats/MediaCard.tsx` | Media placeholder + click-to-download affordance. |
| `dashboard/src/components/chats/DateSeparator.tsx` | "Today"/"Yesterday"/date divider between message groups. |
| `dashboard/src/components/chats/InfoPanel.tsx` | Right-side contact-info drawer. |
| `dashboard/src/components/chats/helpers.tsx` | Shared formatting helpers (`formatChatTime`, `highlightMatch`). |
| `dashboard/src/components/chats/types.ts` | Shared TypeScript types (`ChatWithSession`, `ChatMessageView`, etc.). |
| `src/modules/session/session.controller.ts` | Backend controller exposing `/sessions/:id/chats`, `/messages`, etc. |
| `src/modules/session/session.service.ts` | `getChats()`, `getChatsFromStoredMessages()` fallback, `sendSeen`, `deleteChat` — the logic behind every Chats-page API call. |
| `src/modules/message/entities/message.entity.ts` | `Message` TypeORM entity — the schema backing stored chat history. |
| `src/engine/adapters/` | Engine adapter implementations (whatsapp-web.js, baileys) — what `getChats()` calls when a session is actually connected. |
| `.env.minimal` | Minimal dev env config — base this session's `.env` on it for local testing. |
| `package.json` (root) | `build:all`, `dashboard:build`, `start:prod` scripts. |
| `docker-compose.dev.yml` | Single-container dev compose reference (not used directly for this session's manual verification, but the architecture it encodes — one Nest process serving the bundled dashboard — is what `npm run build:all && node dist/main.js` reproduces locally). |

---

## 10. Current Git State

- **Branch:** `claude/sweet-cannon-q8e6nf` (pushed to `origin`, up to date as of the latest commit below).
- **Working tree:** clean (no uncommitted changes) as of the end of this session.
- **Latest commits (newest first):**
  - `084c6e7` — Disable unimplemented voice/video call buttons in Chats header. *(This session's only commit — fixed a real placeholder-button defect found during verification, verified via Playwright DOM inspection that `disabled` + dimmed opacity actually render.)*
  - `5985cdd` — "Redesign Chats into a premium WhatsApp/iMessage client with real Liquid Glass." *(Unverified by screenshot evidence at time of commit; this session verified the **current state** of the app — after `084c6e7` on top of it — does render with real data correctly in the real app, in both themes, but did **not** do a rigorous before/after comparison against pre-`5985cdd` screenshots, so "is this commit's claim true" is still not fully closed out — see Section 13.)*
  - `4fb714a` — CSS consolidation (de-duplication) of message-bubble rules.
  - `3fe5a0c` — "Make Chats UI visibly WhatsApp Desktop + Apple glass."
  - `e111d00` — "Redesign Chats inbox into WhatsApp-Desktop-style support UI."
  - `965a1c0` — Full chat history + on-demand media download (functional, not just visual).
  - Earlier history: see `git log --oneline` for the full ~25-commit trail; the two "redesign waves" are `86178d0`...`c930eb8` and `e111d00`...`5985cdd`.

---

## 11. Verification Process

This is the process actually used and proven workable in this session. Repeat it exactly; do not substitute a static-HTML shortcut.

1. **Build everything:** from repo root, `npm run build:all` (runs `nest build && npm run dashboard:build`, which itself runs `tsc -b && vite build` inside `dashboard/`). Must complete with no errors. Note the build emits a "chunks larger than 500kB" warning — this is pre-existing and not a blocker.
2. **Typecheck:** `npx tsc --noEmit` from repo root. As of `084c6e7`, exactly 2 pre-existing, unrelated errors exist (`contact.service.spec.ts`, `infra.controller.spec.ts`) — confirmed pre-existing by checking they reproduce on a clean checkout with no diff. Any *new* error is a real problem; do not proceed past it.
3. **Prepare a dev environment:** `cp .env.minimal .env` then append `ALLOW_DEV_API_KEY=true` (gives a well-known `dev-admin-key` API key instead of a random one, so it can be scripted without reading server logs each time).
4. **Boot the real server:** `node dist/main.js` (or `nohup ... &` if you need the shell back). Confirm it logs `Nest application successfully started` and `Dashboard: serving bundled UI at http://localhost:2785`.
5. **Get real data without a live WhatsApp session** (since this sandbox cannot reach `web.whatsapp.com` — confirmed this session via `net::ERR_TUNNEL_CONNECTION_FAILED`):
   - `POST /api/sessions` with `X-API-Key: dev-admin-key` to create a session row.
   - `POST /api/sessions/:id/start` — this will fail to actually connect (expected, no internet to WhatsApp), **but it populates the in-process `engines` map**, which is what `getChats()` checks before it's willing to fall back to stored messages. Without calling `/start` at least once per server process lifetime, `getChats()` throws `BadRequestException('Session is not started')` instead of falling back.
   - Directly insert rows into the `messages` table in the SQLite file (`./data/openwa.sqlite` per `.env.minimal`) via `node` + the `sqlite3` npm package already present in `node_modules` — match the `Message` entity's columns exactly (`sessionId`, `chatId`, `from`, `to`, `body`, `type`, `direction`, `timestamp`, `status`, `createdAt`).
   - Directly `UPDATE sessions SET status='ready', ...` in the same SQLite file so the dashboard's session picker treats it as a connected/selectable workspace (the frontend filters to `status === 'ready'`).
   - Confirm via `curl -H "X-API-Key: dev-admin-key" http://localhost:2785/api/sessions/:id/chats` that real chat summaries come back through the **real API**, not mocked.
6. **Drive a real browser against the real running server:** use Playwright (`require('/opt/node22/lib/node_modules/playwright')` if not present in project `node_modules`; Chromium executable is at `/opt/pw-browsers/chromium` in this sandbox — do not run `playwright install`). Navigate to `http://localhost:2785/`, set `localStorage.setItem('openwa_api_key', 'dev-admin-key')` (verify this exact key name in `dashboard/src/App.tsx`/`services/api.ts` before assuming — it has changed names before, e.g. there's also an unrelated `openwa_theme` key for theme persistence), then navigate to `/chats`.
7. **Take real screenshots**: full page, chat list, open conversation, header close-up, composer, info panel — in light mode (default) and dark mode (set `localStorage.setItem('openwa_theme', 'dark')` before navigating, or use the in-app theme toggle button which cycles light → dark → system).
8. **Verify specific behaviors, not just the static look**: click a chat row and confirm the conversation actually loads (not just that it looks right in a screenshot); use `page.$$eval` to assert real DOM properties (e.g. this session used it to confirm `disabled: true` and `opacity: "0.35"` on the call buttons, rather than trusting that the CSS/JSX *should* produce that).
9. **Verify mobile** by re-running with a narrow viewport (`page.setViewportSize` or a new context with e.g. `{ width: 390, height: 844 }`) and screenshotting again. **This step was not actually performed in this session — do it before claiming responsive behavior works.**
10. **Verify media** by seeding a message row with `type` set to a media type and confirming the placeholder + download button render and the click handler fires. **Also not actually performed in this session** — no real media-bearing message was seeded, only text. Flagged in Section 4.
11. **Verify message ownership, reply cards, scrolling** similarly — by seeding rows that exercise those code paths (incoming vs outgoing `direction`, a message whose `metadata` includes a quoted/reply reference) and checking the real rendered output, not by reading the component source and assuming it's correct.
12. **Only after all of the above for the specific change being made** — commit, with a message that describes what's visually/behaviorally different, and ideally reference that screenshots were taken (even if they can't be embedded in the commit itself).

---

## 12. Next Highest Priority Tasks

Ordered highest → lowest impact:

1. **Close the open verification gap on `5985cdd` itself.** Take real before-screenshots from the *pre-5985cdd* commit (`git checkout 4fb714a`, build, boot, screenshot) and real after-screenshots from current `HEAD`, side by side, and make an honest call: is the difference "immediately obvious"? If not, this redesign is still not actually substantiated, and further design work should happen before any more "redesign complete" claims.
2. **Verify media handling end-to-end** — seed a real media-type message row, confirm the placeholder card renders correctly and the click-to-download path actually works against the configured `STORAGE_TYPE=local` backend, in both themes.
3. **Verify the conversation-level Search and More-options buttons** actually do something (`onSearchClick`, `onMoreClick` in `ConversationHeader.tsx`) — if they're unwired, apply the same disabled+honest-label fix used for Phone/Video in `084c6e7`, or wire real behavior, per the user's explicit "no placeholder buttons" rule.
4. **Audit `Chats.css` for remaining duplicate/competing selectors** beyond the bubble-CSS cleanup already done in `4fb714a` — the file is 2600+ lines and has a documented history of this exact problem; a full pass (grep every class name used in `components/chats/*.tsx` against `Chats.css` occurrence counts) would catch any other lingering duplicates.
5. **Responsive/mobile pass** — actually test at a phone-width viewport with real screenshots; fix whatever breaks.
6. **Performance** — at minimum, decide whether list virtualization is in scope for "redesign," and if a real support inbox could plausibly have hundreds of chats/thousands of messages, treat the lack of virtualization as a real risk, not a someday-nice-to-have.
7. **Accessibility pass** — keyboard navigation through the chat list and composer, screen-reader labels audit beyond the spot-check done this session, color-contrast check on glass surfaces in both themes.
8. **Animation/motion design** — only after the above are solid; currently no deliberate motion exists beyond hover transitions.

---

## 13. Final Honest Assessment

If a senior frontend engineer opened this project today, here is what they would immediately flag:

- **"Show me the before/after" would have no answer.** Despite ~12+ commits explicitly about visual redesign, there is no artifact anywhere in the repo or commit history that lets anyone — including the engineers who did the work — compare old vs. new. That's a process failure independent of whether the new design is actually good.
- **Two full redesign cycles for the same stated goal is a red flag**, not a sign of iteration. It strongly suggests the first "this is done" claim was never actually checked against reality, and the underlying habit (ship, claim, move on) wasn't fixed by the second attempt either — it took an external, explicit instruction in this session to finally force real-app verification.
- **A 2600-line single CSS file with a documented history of duplicate/competing selectors** is a maintainability smell. Even after one consolidation pass (`4fb714a`), there's no guarantee — and no audit performed — that it's the only such duplication in the file.
- **Dead/placeholder buttons reaching a "complete" commit at all** (the Phone/Video buttons) is a basic QA miss. It was caught this session only because verification was forced; it should have been impossible to miss if the component had ever actually been clicked through in a browser before being called done.
- **No automated test coverage is mentioned anywhere in this history** for the Chats feature — no component tests, no E2E test asserting the chat list renders rows, the composer sends, the info panel toggles. Every verification done (including this session's) has been manual, ad hoc, and would need to be fully redone for the next change. That's not sustainable for a feature this complex.
- **The backend's silent fallback from live-engine chats to stored-message-derived chats** (`getChatsFromStoredMessages`) has no UI indication anywhere — a support agent looking at the Chats page in a real deployment where WhatsApp briefly disconnects would see what looks like live data but might be stale, with zero signal that it's degraded. That's a real product/trust issue uncovered as a side effect of needing a verification workaround in this sandboxed environment, not something invented for this document — it deserves a real ticket, not a shrug.
- **No performance or accessibility work has been done at all**, despite the feature being positioned as a "premium" experience — premium implies both, and neither has been touched.

None of this is meant to relitigate prior work defensively. It's the actual state of the project. The next session's job is to close these gaps with verified, screenshot-backed, real-app-tested changes — not to add a third redesign wave on top of an unverified second one.
