/// <reference types="vite/client" />
/** Keep the glob rooted at convex so the test backend resolves nested agent modules consistently. */
export const modules = import.meta.glob([
  "./**/*.{ts,js}",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);
