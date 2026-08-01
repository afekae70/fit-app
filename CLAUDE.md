# Project conventions

Read this before changing code. These are the rules that were learned the hard way — each one
here cost real debugging time at least once.

## Architecture in one paragraph

An Expo/React Native app (`apps/mobile`) that is **offline-first**: every mutation writes
straight to local SQLite, and the UI reloads from the database rather than trusting component
state. A Fastify service (`apps/api`) exists for exactly one reason — to hold the LLM key, which
must never ship inside the app bundle. `packages/shared` holds the physiology calculations and
Zod schemas that both sides import, so the number on screen and the number the coach reasons
about can never drift apart.

## Hard rules

### Never mix animation driver modes on one node

Putting a `useNativeDriver: true` animated value and a `useNativeDriver: false` one in the same
`Animated` component's style array is a **fatal crash**, not a warning:

```
Attempting to run JS driven animation on animated node that has been moved to "native" earlier
```

Colour and layout properties cannot use the native driver; `opacity` and `transform` can. When a
component needs both, split it into nested `Animated.View`s, one per driver mode — see
`SegmentButton` in `src/components/ui.tsx`, which is the fix for a crash this actually caused.

### Never add a native module without saying so

`expo-haptics`, `expo-linear-gradient`, `react-native-ble-plx` and friends contain native code.
Adding one means the installed dev client is stale and **must be rebuilt** — the JS will load and
then fail at the call site. When a feature seems to want a new native dependency, prefer a
core-React-Native solution: `PanResponder` is why `SwipeableRow` and the weight chart's scrub
work without `react-native-gesture-handler`.

### Every screen is RTL-first

Hebrew is the primary language. Use logical properties only — `marginStart`/`marginEnd`,
`paddingStart`/`paddingEnd`, `textAlign: 'auto'` — never `left`/`right`. React Native mirrors the
logical ones automatically.

The exception is **gestures**: a touch's `dx` is a physical delta and does not mirror, so a
swipe direction has to be flipped explicitly against `I18nManager.isRTL` (see `SwipeableRow`).
Note it keys off `I18nManager.isRTL`, not the active i18next language — the two disagree briefly
after a language switch, until the app is reopened.

### Styles are functions of the palette

`const createStyles = (colors: ColorPalette) => StyleSheet.create({...})` at module scope, and
each component does `const { colors } = useTheme()` plus
`useMemo(() => createStyles(colors), [colors])`. A `StyleSheet.create` evaluated once at module
load cannot repaint on a light/dark switch.

### Both locale files or neither

`en.ts` is typed against `he.ts`. A key in one and not the other is a compile error, which is the
point — a missing string should not be discovered at runtime in whichever screen used it.

### Schema changes need a migration, not just a schema edit

`CREATE_SCHEMA_SQL` only runs on a fresh database. Real devices have real workout data, so a new
column or table also needs an entry in `MIGRATIONS` keyed by the version it upgrades **to**, plus
a bump of `SCHEMA_VERSION` and an addition to `resetDb()`'s drop list in `db/index.ts`.

## Testing

The repository layer is written against the `SqlExecutor` seam specifically so tests can run real
SQL against real SQLite (`node:sqlite`) instead of a mock that can only ever agree with the code
under test. Use `createTestExecutor()` from `src/db/testUtils.ts`.

`expo-sqlite` is native and cannot load under vitest — that is why `db/provider.ts` is the only
module allowed to import it.

Before saying anything works:

```bash
npm run typecheck && npm test
```

## What is deliberately absent

- **`expo-updates`** was removed on purpose. On Android's New Architecture any crash left a
  permanently blank Activity with a destroyed React context (expo/expo#41543). Do not reinstall
  it to add OTA updates without re-testing that specific failure.
- **A running clock during a workout.** Total duration appears in the finish summary instead;
  a ticking timer pressures people to cut rest short.
- **Automatic application of AI output.** Plans and menus render as cards the user reviews. The
  Apply button is the only path that writes to the plan tables.
