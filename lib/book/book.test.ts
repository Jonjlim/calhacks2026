import { beforeEach, describe, expect, it } from "vitest";
import { book, BOOK_CLOSE_MS, BOOK_OPEN_MS } from "@/components/book/bookStore";
import { MOTIFS, motifFor } from "@/components/book/motifs";

describe("book store", () => {
  beforeEach(() => {
    book.open = false;
    book.openedAt = book.closedAt = -1e9;
  });

  it("is shut on its stand until opened, then rises and settles open", () => {
    expect(book.progress(0)).toBe(0);
    book.show();
    const t = book.openedAt;
    expect(book.progress(t)).toBe(0);
    expect(book.progress(t + BOOK_OPEN_MS / 2)).toBeGreaterThan(0.3);
    expect(book.progress(t + BOOK_OPEN_MS + 10)).toBe(1);
  });

  it("folds back down when closed, and remembers what it was opened for", () => {
    book.show({ theme: "Hiking", listingId: "l1" });
    expect(book.theme).toBe("Hiking");
    expect(book.listingId).toBe("l1");
    book.hide();
    const t = book.closedAt;
    expect(book.progress(t + 1)).toBeGreaterThan(0.9);
    expect(book.progress(t + BOOK_CLOSE_MS + 10)).toBe(0);
  });

  it("opens once: a second show while open does nothing", () => {
    book.show({ theme: "Art" });
    book.show({ theme: "Other" });
    expect(book.theme).toBe("Art");
  });
});

describe("book illustrations", () => {
  it("follows the theme in focus, with a garden for anything else", () => {
    expect(motifFor("Weekend hikes").id).toBe("hiking");
    expect(motifFor("Pottery and painting").id).toBe("creative");
    expect(motifFor("Cozy evenings").id).toBe("cozy");
    expect(motifFor("Wishes").id).toBe("wishes");
    expect(motifFor("Birthdays").id).toBe("garden");
    expect(motifFor(null).id).toBe("garden");
  });

  it("every motif has pencil lines to draw and washes to bloom", () => {
    for (const m of Object.values(MOTIFS)) {
      expect(m.lines.length).toBeGreaterThan(2);
      expect(m.washes.length).toBeGreaterThan(0);
    }
  });
});
