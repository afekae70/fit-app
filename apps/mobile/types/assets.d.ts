/**
 * Local asset imports.
 *
 * Metro turns `import beep from './beep.wav'` into an asset id — a number the audio player
 * accepts as its source. TypeScript has no idea that happens, and Expo's own types do not
 * declare it, so without this the only way to reach a bundled file is `require()`, which the
 * lint config forbids for good reason everywhere else.
 */
declare module '*.wav' {
  const asset: number;
  export default asset;
}

declare module '*.png' {
  const asset: number;
  export default asset;
}
