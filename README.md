# Fit App

Personal training, nutrition tracking, and AI coaching. Hebrew-first (RTL), Android + iOS.

Architecture and the full 5-phase plan: `~/.claude/plans/role-objective-you-glittery-dusk.md`

## Layout

```
apps/api/          Fastify service — AI calls, calculations, weekly recalculation cron
apps/mobile/       Expo app (not yet scaffolded — needs Node 20+)
packages/shared/   Calculations + Zod schemas, imported by BOTH app and API
```

`packages/shared/src/calculations/` is deliberately shared: the TDEE the dashboard displays
and the TDEE the AI coach reasons about come from the same function, so they cannot drift.

## Current status

| Component | State |
|---|---|
| Monorepo + tooling | Done |
| Shared calculations | Done — 51 tests passing |
| Database schema | Done — 17 tables, SQL generated |
| RLS policies + platform objects | Written, **not yet applied to a database** |
| Seed data (41 equipment, 100+ exercises) | Done — 17 integrity tests passing |
| Fastify service | Not started |
| Expo app | Blocked on Node 20+ |

## Prerequisites

You need to do these three things before the project can run end to end:

**1. Node 20+ (currently 18.16).** Blocks both Expo and pnpm. Options:

```bash
winget install CoreyButler.NVMforWindows
```

Then `nvm install 22 && nvm use 22` — this keeps Node 18 available for your other
projects. Alternatively `winget install OpenJS.NodeJS.LTS` replaces Node globally, which
is simpler but may affect anything else on this machine that expects 18.

**2. A Supabase project.** Create one at supabase.com, then `cp .env.example .env` and
fill in the URL, keys, and both database URLs.

**3. An Apple Developer account** ($99/yr) — only needed for iOS builds, which run through
EAS Build since there is no Mac here. Not required to start on Android.

## Setup

```bash
npm install
```

Once `.env` has a real `DATABASE_URL_DIRECT`:

```bash
DATABASE_URL="$DATABASE_URL_DIRECT" npm run db:migrate
```

```bash
DATABASE_URL="$DATABASE_URL_DIRECT" npm run db:seed
```

## Verify

```bash
npm test
```

68 tests, no database required. They check the physiological formulas against hand-computed
values and the seed data for referential integrity.

### The one test that matters most

After applying migrations, confirm Row Level Security actually isolates users. Create two
accounts, then with user B's anon key try to read user A's rows:

```sql
select count(*) from sets;
```

This must return 0. `sets` is where all training data lives, and it has no `user_id` column
of its own — it reaches its owner through `session_exercises -> workout_sessions`. If that
policy is wrong, every user's training history is readable by any authenticated account.

## Notes

- **Dynamic set counts** are the core schema decision: one row per set in `sets`, so chest
  press with 4 sets and face pulls with 2 coexist in one session with no nullable
  `set1_reps`/`set2_reps` columns. Adding a set is an INSERT; removing one is a DELETE plus
  automatic renumbering by a trigger.
- **Plan A / Plan B** is the `plan_variants` table — one plan, one variant per location,
  with `location_equipment` recording what each place actually has.
- **BLE testing needs a physical phone.** Bluetooth does not work in Expo Go or any
  simulator; it requires a development build on real hardware.
- A smart scale has not been chosen yet. The **Xiaomi Mi Body Composition Scale 2** (~$35) is
  the recommended target — it broadcasts weight in a plain BLE advertisement. Withings,
  Renpho and Eufy encrypt theirs or require cloud pairing.
- `npm audit` reports findings in `vite`/`vitest` only. Dev-only test tooling, never shipped;
  fixing needs a vitest major bump, deferred until after the Node upgrade.

## Running on your phone (Expo Go)

No Android Studio, cable, or Apple account needed for this — those are only required in
Phase 4, when Bluetooth arrives.

1. Install **Expo Go** on your phone (Play Store / App Store).
2. Put the phone on the same WiFi network as this machine.
3. Start the dev server:

```bash
npm run start --workspace @fit/mobile
```

4. Scan the QR code with Expo Go (Android) or the Camera app (iOS).

If the phone cannot reach the server — common on networks with client isolation, such as
many corporate or campus WiFi — use a relay tunnel instead:

```bash
npm run start:tunnel --workspace @fit/mobile
```

### What works right now

The **Today** tab is a live BMR / TDEE / macro calculator running the real `@fit/shared`
code — the same module the API imports, so the numbers on screen are the numbers the AI
coach will reason about. Change weight, height, age, sex, activity level or goal and the
targets recompute immediately.

Tap the language button top-right to switch Hebrew ⇄ English. Strings swap instantly;
RTL/LTR layout mirroring only applies after the app is reopened, which is a React Native
constraint (`I18nManager.forceRTL` is applied at startup) rather than a bug — the app tells
you when a reopen is needed.

The other three tabs are labelled placeholders naming the phase that builds them.
