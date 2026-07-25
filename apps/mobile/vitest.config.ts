import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only the pure-logic layer is tested here. React Native components need a native
    // runtime and are verified by bundling + on-device use, not by vitest.
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        // Vite does not yet know `node:sqlite` (added in Node 22) and tries to resolve it as
        // a package named "sqlite". Externalising every node: builtin hands it to Node.
        external: [/^node:/],
      },
    },
  },
});
