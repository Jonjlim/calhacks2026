/** Sorts scraped related searches into buyable gift directions. The model only labels; it cannot add searches. */
import { z } from "zod";
import type { ModelTransport } from "../agents/model";
import { validatedModelCall } from "../agents/model";

const schema = z.object({
  items: z.array(z.object({
    query: z.string().max(160),
    kind: z.enum(["product", "style", "experience", "not_gift"]),
  }).strict()).max(60),
}).strict();

const INSTRUCTIONS = `You sort Google search phrases for a gift-finding app.
For each phrase, decide what a shopper would be looking for:
- "product": a physical thing you can buy (gear, clothing item, tool, book, kit, decor).
- "style": a fashion or aesthetic look you can shop for (outfits, a named style).
- "experience": something bookable or ticketed (class, lesson, tour, tickets, membership, party package).
- "not_gift": news, deaths, accidents, people, sports scores, schedules, places to visit for free, how-to or informational lookups, brands' customer service, anything else.
When unsure, answer "not_gift". Return JSON {"items":[{"query": <phrase copied exactly>, "kind": ...}]} with one item per input phrase.`;

export async function screenTrendQueries(transport: ModelTransport, seedTerm: string, queries: string[]): Promise<string[] | null> {
  try {
    const result = await validatedModelCall(transport, {
      role: "extractor", instructions: INSTRUCTIONS, input: { interest: seedTerm, phrases: queries },
    }, schema);
    const offered = new Set(queries);
    // Exact matches only, so a model typo or invented phrase is never shown.
    return [...new Set(result.items.filter(i => i.kind !== "not_gift" && offered.has(i.query)).map(i => i.query))];
  } catch {
    return null;
  }
}
