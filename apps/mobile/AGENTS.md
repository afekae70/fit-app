# Expo SDK 54 — read the versioned docs

This app is pinned to **Expo SDK 54** (`expo@54.0.36`, React Native 0.81.5, React 19.1.0).

Read https://docs.expo.dev/versions/v54.0.0/ — not the "latest" docs. Expo's APIs change
between SDKs and the unversioned pages describe whichever SDK is current, which is not this one.

## Why SDK 54 specifically

Expo Go supports exactly **one** SDK version, and from SDK 54 onward the Expo Go app version
mirrors the SDK number. The installed Expo Go on the target device is 54.x, so the app must stay
on SDK 54 until that app is updated. Bumping the SDK here without bumping Expo Go produces a
"requires a newer version of Expo Go" error on launch with no other clue as to the cause.

Once a development build replaces Expo Go, this constraint goes away — a dev build ships its own
native runtime. Bump the SDK on its own, not alongside other native changes, so a failed build
has one suspect instead of two.

## React must be a single copy

React Native tolerates exactly one copy of React; two produce `Invalid hook call` at runtime
rather than a build error. The root `package.json` pins it via `overrides`, and the version
tracks the SDK — 19.1.0 for SDK 54.
