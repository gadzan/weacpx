# Home page chat mockup

Drop real device screenshots here. The home hero renders `chat-hero.png`
automatically once it exists; until then a placeholder frame is shown.

## Required file

| File | Where it shows | Frame |
|------|----------------|-------|
| `chat-hero.png` | Hero, right of the headline (`ChatMockup.vue`) | Portrait phone, ~9:19. A WeChat/Feishu thread is ideal. |

## What to capture (one clean thread that tells the whole story)

Shoot a single chat conversation, top to bottom, that shows xacpx working:

1. **You start a session** — a sent message: `/ss codex -d ~/projects/api`
   and xacpx's reply confirming the session (alias + agent + workspace).
2. **You send a plain prompt** — e.g. `add a /health endpoint and run the tests`.
3. **The agent works and replies** — a substantive answer with a short result /
   tool summary (this is the "it actually did the thing" moment).
4. **A control command** — `/status` (or `/cancel`) and its reply, to show
   live control of the session.

Tips:
- Use the app's dark mode if available — it sits better on the dark hero.
- Crop to the device screen (no OS status bar clutter is fine, but keeping the
  chat header with the contact name "xacpx" reads well).
- Portrait orientation, roughly 9:19. Export at 2x (e.g. ~1080×2280) so it
  stays crisp on retina.
- Scrub any private workspace paths / tokens before committing.

## Optional follow-ups (not wired in yet — ask if you want them)

- `chat-feishu.png`, `chat-yuanbao.png` — per-channel variants if we later make
  the mockup swap with the install tabs.
