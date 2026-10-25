import assert from "node:assert/strict";
import { test } from "node:test";
import { TWIN_LIMITS } from "../../lib/agentCollaborators/contracts.ts";
import { fixtureMessages } from "../src/fixture.ts";
import { planUpload, toVaultMessages } from "../src/upload.ts";

test("uploads only the recipient's own messages, as text and time only", () => {
  const messages = fixtureMessages(Date.UTC(2026, 9, 24));
  const vault = toVaultMessages(messages);
  assert.equal(vault.length, messages.filter((m) => m.fromMe).length);
  assert.ok(vault.every((m) => Object.keys(m).sort().join() === "sentAt,text"));
  const all = JSON.stringify(vault);
  assert.doesNotMatch(all, /get the salomon one|you should come backpacking/, "friends' messages stay on the Mac");
});

test("batches respect the server's per-call limits", () => {
  const long = "x".repeat(TWIN_LIMITS.messageMaxChars + 50);
  const messages = Array.from({ length: 2_500 }, (_, i) => ({ id: i, text: i % 2 ? long : "I love matcha", fromMe: true, sentAt: i, chatId: 1 }));
  const plan = planUpload(messages);
  assert.equal(plan.messages.length, 2_500);
  assert.ok(plan.batches.length > 1);
  for (const batch of plan.batches) {
    assert.ok(batch.length <= TWIN_LIMITS.uploadBatchMaxMessages);
    assert.ok(batch.reduce((n, m) => n + m.text.length, 0) <= TWIN_LIMITS.uploadBatchMaxChars);
    assert.ok(batch.every((m) => m.text.length <= TWIN_LIMITS.messageMaxChars));
  }
  assert.equal(plan.batches.flat().length, 2_500);
});
