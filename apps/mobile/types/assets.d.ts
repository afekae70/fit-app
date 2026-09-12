/**
 * Local image imports.
 *
 * Metro turns `import logo from './logo.png'` into an asset id — a number `Image` accepts as its
 * `source`. TypeScript has no idea that happens, and Expo's own types do not declare it, so
 * without this the only way to reach a bundled image is `require()`, which the lint config
 * forbids for good reason everywhere else.
 */
declare module '*.png' {
  const asset: number;
  export default asset;
}

declare module '*.jpg' {
  const asset: number;
  export default asset;
}
