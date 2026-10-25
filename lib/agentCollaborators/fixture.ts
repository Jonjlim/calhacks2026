/**
 * Synthetic iMessage history for demos and tests. Fictional person,
 * fictional friends. Includes a sensitive line on purpose so the demo shows
 * it never reaches the room. Dependency-free: the companion runs it under
 * Node type stripping.
 */
const LINES: ReadonlyArray<readonly [fromMe: boolean, text: string]> = [
  [false, "are you coming saturday?"],
  [true, "yes!! but I have a long run in the morning, I've been really into trail running lately"],
  [false, "since when lol"],
  [true, "since march. the Dipsea trail destroyed me but I love it"],
  [true, "I really want a hydration vest, holding a water bottle the whole time is so annoying"],
  [false, "get the salomon one"],
  [true, "maybe for my birthday haha"],
  [true, "also I'm obsessed with matcha right now, I make it every morning"],
  [false, "you and your matcha"],
  [true, "I just got a new Kindle so please stop sending me paperbacks"],
  [false, "ok ok"],
  [true, "I can't stand scented candles, they give me a headache"],
  [false, "noted for christmas"],
  [true, "my favorite color is sage green btw, for the record"],
  [false, "what are you reading"],
  [true, "the Murderbot series, I love sci-fi audiobooks on my runs"],
  [true, "I want to try pottery so badly, there's a studio near my place"],
  [false, "we should go together"],
  [true, "my therapist said I should do more hands-on stuff anyway"],
  [true, "I already have AirPods Pro, they're great for runs"],
  [false, "did you see the new trail shoes"],
  [true, "I hate how heavy most trail shoes are"],
  [true, "I've been really into trail running, did 10 miles today"],
  [true, "I love matcha, ordered a new whisk"],
  [false, "happy friday!"],
  [true, "honestly I'm not a fan of gift cards, feels impersonal"],
  [true, "I really want a hydration vest before the half marathon"],
  [true, "I love sci-fi audiobooks, just finished another one"],
  [true, "honestly I love trail running, best part of my week"],
  [true, "I love you guys so much"],
  [true, "I just got home, so tired"],
  [true, "I already have a Kindle, stop with the paperbacks"],
  [true, "I really want to try pottery, the studio has a beginner class"],
  [true, "please no candles, I hate scented candles"],
  [true, "reminder that my favorite color is sage green"],
  [true, "I love dinner at that place"],
  [true, "I've been playing tennis a lot with the work crew"],
  [true, "I've been wanting an Arc'teryx jacket forever"],
  [false, "you should come backpacking with us in june!"],
  [true, "ugh no, I hate backpacking, never again after that trip"],
];

export interface SampleMessage {
  text: string;
  fromMe: boolean;
  sentAt: number;
}

/** Oldest first, three days apart, ending at `now`. */
export function sampleChat(now: number = Date.now()): SampleMessage[] {
  const start = now - LINES.length * 3 * 86_400_000;
  return LINES.map(([fromMe, text], i) => ({ text, fromMe, sentAt: start + i * 3 * 86_400_000 }));
}
