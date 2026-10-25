import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts", "convex/**/*.test.ts"],
    // Publishing a memory schedules a paid trend lookup; tests that want it turn it back on.
    env: { TREND_AUTO_DISCOVERY: "off" },
  },
});
