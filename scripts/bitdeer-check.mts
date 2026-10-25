/** Candidate-provider smoke test only. Synthetic inputs, max 3 paid calls, no retries or app writes. */
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const endpoint = "https://api-inference.bitdeer.ai/v1/chat/completions";
const defaultModel = "zai-org/GLM-5.3-Flash";
const allowedModels = new Set([defaultModel, "deepseek-ai/DeepSeek-V4.1-Flash-1017", "Qwen/Qwen3.8-27B"]);

function chunk(kind: string, bytes: Buffer) {
  const type = Buffer.from(kind), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  let value = 0xffffffff;
  for (const b of Buffer.concat([type, bytes])) {
    value ^= b;
    for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  crc.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, type, bytes, crc]);
}
/** Generated test pixels, never a user's private photo. */
export function syntheticImage(kind: "triangle" | "circle") {
  const width = 256, height = 256, rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const inside = kind === "triangle" ? y >= 40 && y <= 210 && Math.abs(x - 128) <= (y - 40) * .55 : (x - 128) ** 2 + (y - 128) ** 2 <= 75 ** 2;
      if (!inside) continue;
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      rows[offset] = kind === "triangle" ? 230 : 20;
      rows[offset + 1] = 30; rows[offset + 2] = kind === "circle" ? 230 : 25;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const clueSchema = z.strictObject({ clues: z.array(z.strictObject({
  kind: z.enum(["interest", "ownership", "exclusion"]), text: z.string().min(1).max(200),
  sourceMessageIds: z.array(z.literal("sample-message")).min(1),
})).min(3).max(5) });
const choiceSchema = z.strictObject({ listingId: z.literal("sample-mug"), publishedClueIds: z.array(z.literal("sample-pottery")).length(1) });
const visionSchema = z.strictObject({ images: z.array(z.strictObject({ number: z.number().int(), color: z.enum(["red","blue","green","yellow"]), shape: z.enum(["triangle","circle","square"]) })).length(2) });
type Content = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
const cases: Array<{ name: string; instructions: string; content: Content; check: (data: unknown) => boolean }> = [
  { name: "clue extraction with source references", instructions: 'Return JSON only: {"clues":[{"kind":"interest|ownership|exclusion","text":"short paraphrase","sourceMessageIds":["sample-message"]}]}. Extract the three distinct facts. Do not add facts.',
    content: 'Synthetic message sample-message, spoken by the recipient: "I love pottery. I already own a pottery starter kit. Please no more candles."',
    check(data) { const result = clueSchema.safeParse(data); return result.success && ["interest","ownership","exclusion"].every(kind => result.data.clues.some(c => c.kind === kind && (kind === "exclusion" ? /candle/i : /pottery/i).test(c.text))); } },
  { name: "grounded gift choice with budget and ownership", instructions: 'Return JSON only: {"listingId":"supplied ID","publishedClueIds":["supplied clue ID"]}. Choose one supplied candidate that matches a confirmed interest, fits the budget and is not already owned. Never invent IDs.',
    content: JSON.stringify({ syntheticFixture: true, budgetMinor: 4000, currency: "USD", publishedClues: [{id:"sample-pottery",text:"Enjoys pottery"},{id:"sample-owned",text:"Already owns a pottery starter kit"}], listings: [{id:"sample-mug",title:"Handmade pottery mug",priceMinor:3800},{id:"sample-kit",title:"Pottery starter kit",priceMinor:3500},{id:"sample-luxury",title:"Pottery wheel",priceMinor:40000}] }),
    check(data) { return choiceSchema.safeParse(data).success; } },
  { name: "image input and visual discrimination", instructions: 'Examine the two images in order. Return JSON only: {"images":[{"number":1,"color":"red|blue|green|yellow","shape":"triangle|circle|square"},{"number":2,"color":"red|blue|green|yellow","shape":"triangle|circle|square"}]}. Describe the large colored shape in each image.',
    content: [{type:"text",text:"Identify the colored shapes in image 1 and image 2."}, {type:"image_url",image_url:{url:`data:image/png;base64,${syntheticImage("triangle")}`}}, {type:"image_url",image_url:{url:`data:image/png;base64,${syntheticImage("circle")}`}}],
    check(data) { const r = visionSchema.safeParse(data); return r.success && r.data.images[0]?.number === 1 && r.data.images[0]?.color === "red" && r.data.images[0]?.shape === "triangle" && r.data.images[1]?.number === 2 && r.data.images[1]?.color === "blue" && r.data.images[1]?.shape === "circle"; } },
];
export interface CheckResult { name: string; passed: boolean; elapsedMs: number; reason?: string; inputTokens?: number; outputTokens?: number }
export async function runBitdeerChecks(apiKey: string, model = defaultModel, fetcher: typeof fetch = fetch): Promise<CheckResult[]> {
  if (!apiKey.trim() || !allowedModels.has(model)) throw new Error("Set BITDEER_API_KEY and select a supported BITDEER_MODEL. No request was sent.");
  const results: CheckResult[] = [];
  for (const test of cases) {
    const started = performance.now();
    let result: CheckResult;
    try {
      const response = await fetcher(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1600, response_format: {type:"json_object"}, messages: [{role:"system",content:test.instructions},{role:"user",content:test.content}] }) });
      if (!response.ok) { results.push({ name: test.name, passed: false, elapsedMs: Math.round(performance.now() - started), reason: `HTTP ${response.status}; provider body withheld` }); continue; }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty");
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > 128_000) { await reader.cancel(); throw new Error("oversized"); } chunks.push(part.value); }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({content:z.string()}) })).length(1), usage:z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative()}).optional() }).parse(raw);
      const choice = envelope.choices[0]!;
      const passed = choice.finish_reason === "stop" && test.check(JSON.parse(choice.message.content));
      result = { name: test.name, passed, elapsedMs: Math.round(performance.now() - started),
        ...(!passed ? {reason:"Output was incomplete or failed the expected JSON/content checks"} : {}),
        ...(envelope.usage ? {inputTokens:envelope.usage.prompt_tokens,outputTokens:envelope.usage.completion_tokens} : {}) };
    } catch { result = {name:test.name,passed:false,elapsedMs:Math.round(performance.now()-started),reason:"Timed out, transport failed, or response was invalid; no retry"}; }
    results.push(result);
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--run")) {
    console.log("Synthetic Bitdeer candidate check. Running uses credits: at most 3 requests, no retries.\nRun: node --env-file=.env.bitdeer.local scripts/bitdeer-check.mts --run\nNo requests were sent.");
  } else {
    try {
      const results = await runBitdeerChecks(process.env.BITDEER_API_KEY ?? "", process.env.BITDEER_MODEL ?? defaultModel);
      console.log(JSON.stringify({ model:process.env.BITDEER_MODEL ?? defaultModel, allPassed:results.every(r=>r.passed), results,
        scope:"Candidate provider check only. Uses max_tokens; does not change or certify the production model adapter. No Convex, Apify, payment or real user-data calls." },null,2));
      if (results.some(r=>!r.passed)) process.exitCode = 1;
    } catch { console.error("Set BITDEER_API_KEY privately and use a supported BITDEER_MODEL. No request was sent."); process.exitCode = 1; }
  }
}
