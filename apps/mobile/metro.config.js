// Metro config for a monorepo.
//
// Without this, Metro only watches apps/mobile and cannot resolve `@fit/shared` — the import
// fails with "Unable to resolve module" even though npm has linked the workspace package,
// because Metro does its own resolution and does not follow symlinks out of the project root
// by default.
//
// Note on `disableHierarchicalLookup`: deliberately NOT set. It looks like the right guard
// against Metro resolving two copies of React from a hoisted + nested install, but it only
// hides that problem — and it makes `expo-doctor` flag the config as deviating from Expo's
// defaults. The duplicate is fixed properly at its source, by the `overrides` block in the
// root package.json pinning a single React version.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to packages/shared trigger a rebuild.
// Append rather than assign: Expo seeds watchFolders with entries of its own, and replacing
// the array drops them (expo-doctor flags this as "does not contain all entries from Expo's
// defaults").
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Honour the "exports" field in package.json, which is how `@fit/shared/calculations`
// resolves to packages/shared/src/calculations/index.ts.
config.resolver.unstable_enablePackageExports = true;

/**
 * Allow TypeScript's ESM import style (`./foo.js` referring to `./foo.ts`).
 *
 * `packages/shared` is consumed by BOTH the Fastify API (real Node ESM, where the `.js`
 * extension is mandatory) and by this app through Metro (which resolves TS and does not map
 * `.js` back to `.ts`). Rather than maintain two import conventions in one shared package —
 * or ship a build step just to satisfy the bundler — this resolver tries the specifier as
 * written first, then retries without the extension.
 *
 * Original-first ordering matters: genuine `.js` files on disk keep resolving normally, and
 * only a failed lookup falls through to the extensionless retry.
 */
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = originalResolveRequest ?? context.resolveRequest;

  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
    throw error;
  }
};

module.exports = config;
