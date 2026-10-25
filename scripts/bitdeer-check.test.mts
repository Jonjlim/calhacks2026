import { test } from "node:test";
import assert from "node:assert/strict";
import { runBitdeerChecks, syntheticImage } from "./bitdeer-check.mts";
const outputs = [
  {clues:[{kind:"interest",text:"Loves pottery",sourceMessageIds:["sample-message"]},{kind:"ownership",text:"Owns a pottery starter kit",sourceMessageIds:["sample-message"]},{kind:"exclusion",text:"No more candles",sourceMessageIds:["sample-message"]}]},
  {listingId:"sample-mug",publishedClueIds:["sample-pottery"]},
  {images:[{number:1,color:"red",shape:"triangle"},{number:2,color:"blue",shape:"circle"}]},
];
test("synthetic images are distinct PNGs, not user photos", () => {
  assert.notEqual(syntheticImage("triangle"),syntheticImage("circle"));
  assert.equal(Buffer.from(syntheticImage("triangle"),"base64").subarray(0,8).toString("hex"),"89504e470d0a1a0a");
});
test("checks all three cases with fixed host, bounded tokens and image payloads", async () => {
  const calls: {url:string;options:RequestInit}[] = [];
  const results = await runBitdeerChecks("private-fixture-key",undefined,async (url,options)=>{
    calls.push({url:String(url),options:options!});
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(outputs[calls.length-1])}}],usage:{prompt_tokens:10,completion_tokens:20}});
  });
  assert.ok(results.every(r=>r.passed)); assert.equal(calls.length,3);
  for (const call of calls) {
    assert.equal(call.url,"https://api-inference.bitdeer.ai/v1/chat/completions");
    const body=JSON.parse(String(call.options.body));
    assert.equal(body.max_tokens,1600); assert.equal(body.max_completion_tokens,undefined);
    assert.equal(call.options.redirect,"error");
  }
  assert.match(String(calls[2]!.options.body),/data:image\/png;base64/);
  assert.ok(!JSON.stringify(results).includes("private-fixture-key"));
});
test("reports provider refusal without leaking response details or retrying", async () => {
  let calls=0;
  const results=await runBitdeerChecks("private-fixture-key",undefined,async()=>{calls++;return new Response("private provider details",{status:401});});
  assert.equal(calls,3); assert.ok(results.every(r=>!r.passed));
  assert.ok(!JSON.stringify(results).includes("private provider details"));
});
test("refuses guessed image answers and invented product references", async () => {
  const results=await runBitdeerChecks("fixture-key",undefined,async()=>Response.json({choices:[{finish_reason:"stop",message:{content:'{"listingId":"invented-product"}'}}]}));
  assert.ok(results.every(r=>!r.passed));
});
test("fails before any network for missing credentials or an unexpected model", async () => {
  let calls=0; const fetcher:typeof fetch=async()=>{calls++;throw new Error("not called");};
  await assert.rejects(runBitdeerChecks("",undefined,fetcher));
  await assert.rejects(runBitdeerChecks("fixture","unknown-model",fetcher));
  assert.equal(calls,0);
});
