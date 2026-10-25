import { describe, expect, it } from "vitest";
import { selectMemoryMessages, MEMORY_INDEX_LIMIT } from "./memorySelection";

describe("bounded semantic working set", () => {
  it("retains old gift preferences amid thousands of routine messages", () => {
    const old = { text: "I want to learn wheel throwing", sentAt: 0 };
    const recent = { text: "I already have a Kindle", sentAt: 10_000 };
    const messages = [old, ...Array.from({ length: 5_000 }, (_, i) => ({ text: `Heading home after meeting ${i}`, sentAt: i + 1 })), recent];
    const selected = selectMemoryMessages(messages);
    expect(selected).toHaveLength(MEMORY_INDEX_LIMIT);
    expect(selected).toContain(old);
    expect(selected).toContain(recent);
  });

  it("stays bounded when every message expresses a distinct preference", () => {
    const messages = Array.from({ length: 5_000 }, (_, i) => ({ text: `I love hobby ${i}`, sentAt: i }));
    const selected = selectMemoryMessages(messages);
    expect(selected).toHaveLength(MEMORY_INDEX_LIMIT);
    expect(selected[0]).toEqual(messages[0]);
    expect(selected.at(-1)).toEqual(messages.at(-1));
  });

  it("does not repeatedly embed identical messages in large uploads", () => {
    const messages = Array.from({ length: 1_000 }, (_, i) => ({ text: "I love pottery", sentAt: i }));
    expect(selectMemoryMessages(messages)).toHaveLength(1);
  });
});
