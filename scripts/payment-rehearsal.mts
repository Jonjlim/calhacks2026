/** Run only the offline payment fixtures. No keys, provider calls or deployment writes. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
console.log("UNWRAP PAYMENT REHEARSAL — SIMULATION ONLY\nNo Stripe/Convex connections, card entry, real charges or orders.\n");
const result = spawnSync(process.execPath, [runner, "run", "convex/payments/rehearsal.test.ts", "--reporter=verbose"], {
  cwd: root, stdio: "inherit", env: { ...process.env, UNWRAP_PAYMENT_REHEARSAL: "1" },
});
if (result.error) { console.error("The local test runner could not start. Install the repository dependencies first."); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
