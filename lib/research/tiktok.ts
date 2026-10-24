/** Public caption/hashtag evidence only; no growth inference or production score changes. */
import { z } from "zod";
import type { FashionDiscovery, FashionSampleContext, TikTokFashionPost } from "../contracts";
import { categoryForSeed } from "./styleCategories";

const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const contextSchema = z.object({ seedTerm: z.string().trim().min(1).max(100),
  windowStart: timestamp, windowEnd: timestamp, retrievedAt: timestamp,
}).refine(value => value.windowStart <= value.windowEnd && value.windowEnd <= value.retrievedAt);
const rowSchema = z.object({ webVideoUrl: z.string(), text: z.string().max(10000).optional(),
  createTimeISO: z.unknown().optional(), createTime: z.unknown().optional(),
  hashtags: z.array(z.unknown()).optional(),
  playCount: z.unknown().optional(), diggCount: z.unknown().optional(), shareCount: z.unknown().optional(),
  isAd: z.unknown().optional(), isSponsored: z.unknown().optional(),
  authorMeta: z.object({ privateAccount: z.unknown().optional() }).optional(),
});
const alternateSchema = z.object({ postPage: z.string(), title: z.string().max(10000).optional(),
  uploadedAt: z.unknown().optional(), uploadedAtFormatted: z.unknown().optional(),
  hashtags: z.array(z.unknown()).optional(), views: z.unknown().optional(),
  likes: z.unknown().optional(), shares: z.unknown().optional(),
  isAd: z.unknown().optional(), isSponsored: z.unknown().optional(),
  authorProfile: z.object({ privateAccount: z.unknown().optional() }).nullish(),
});
const hashtagSchema = z.object({ name: z.string() });
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function normalizeTikTokPosts(raw: unknown, input: FashionSampleContext): TikTokFashionPost[] {
  const context = contextSchema.safeParse(input);
  if (!context.success || !Array.isArray(raw)) return [];
  const posts: TikTokFashionPost[] = [];
  for (const value of raw) {
    const alternate = alternateSchema.safeParse(value);
    const parsed = rowSchema.safeParse(alternate.success ? {
      webVideoUrl: alternate.data.postPage, text: alternate.data.title,
      createTime: alternate.data.uploadedAt, createTimeISO: alternate.data.uploadedAtFormatted,
      hashtags: alternate.data.hashtags,
      // This Actor documents that omitted source counters become zero. Zero is ambiguous.
      playCount: alternate.data.views === 0 ? undefined : alternate.data.views,
      diggCount: alternate.data.likes === 0 ? undefined : alternate.data.likes,
      shareCount: alternate.data.shares === 0 ? undefined : alternate.data.shares,
      isAd: alternate.data.isAd, isSponsored: alternate.data.isSponsored,
      authorMeta: alternate.data.authorProfile ?? undefined,
    } : value);
    if (!parsed.success || parsed.data.authorMeta?.privateAccount === true) continue;
    const row = parsed.data;
    let sourceUrl: URL;
    try { sourceUrl = new URL(row.webVideoUrl); } catch { continue; }
    if (sourceUrl.protocol !== "https:" || !["www.tiktok.com", "tiktok.com"].includes(sourceUrl.hostname)
      || sourceUrl.username || sourceUrl.password || sourceUrl.port) continue;
    const match = /^\/@([a-zA-Z0-9._]+)\/(?:video|photo)\/(\d+)\/?$/.exec(sourceUrl.pathname);
    if (!match?.[1] || !match[2]) continue;
    const iso = typeof row.createTimeISO === "string" && /^\d{4}-\d{2}-\d{2}T/.test(row.createTimeISO) ? Date.parse(row.createTimeISO) : NaN;
    const seconds = typeof row.createTime === "number" && Number.isSafeInteger(row.createTime) ? row.createTime * 1000 : NaN;
    if (row.createTimeISO !== undefined && !Number.isFinite(iso)) continue;
    if (Number.isFinite(iso) && Number.isFinite(seconds) && Math.abs(iso - seconds) >= 1000) continue;
    const publishedAt = Number.isFinite(iso) ? iso : seconds;
    if (!Number.isSafeInteger(publishedAt) || publishedAt < context.data.windowStart || publishedAt > context.data.windowEnd) continue;
    const hashtags = [...new Set((row.hashtags ?? []).flatMap(tag => {
      const value = typeof tag === "string" ? tag : hashtagSchema.safeParse(tag).data?.name;
      if (!value) return [];
      const name = value.replace(/^#/, "").trim().toLowerCase();
      return /^[\p{L}\p{N}_]{1,80}$/u.test(name) ? [name] : [];
    }))].slice(0, 50);
    const caption = row.text?.trim() ?? "";
    if (!caption && !hashtags.length) continue;
    const flagged = row.isAd === true || row.isSponsored === true
      || /(?:^|\s)#(?:ad|sponsored|paidpartnership|advertisement)\b/i.test(caption)
      || hashtags.some(tag => ["ad", "sponsored", "paidpartnership", "advertisement"].includes(tag));
    sourceUrl.search = "";
    sourceUrl.hash = "";
    posts.push({ source: "tiktok", postId: match[2], sourceUrl: sourceUrl.href,
      creatorKey: match[1].toLowerCase(), caption, hashtags, publishedAt,
      retrievedAt: context.data.retrievedAt,
      ...(count(row.playCount) === undefined ? {} : { views: count(row.playCount) }),
      ...(count(row.diggCount) === undefined ? {} : { likes: count(row.diggCount) }),
      ...(count(row.shareCount) === undefined ? {} : { shares: count(row.shareCount) }),
      advertising: flagged ? "flagged" : row.isAd === false && row.isSponsored === false ? "not_flagged" : "unknown",
    });
  }
  return deduplicateEvidence(posts);
}

/** Conflicting copies are not independent or reliable evidence, in either order. */
function deduplicateEvidence(posts: TikTokFashionPost[]): TikTokFashionPost[] {
  const unique = new Map<string, TikTokFashionPost>();
  const conflicts = new Set<string>();
  const evidenceKey = (post: TikTokFashionPost) => JSON.stringify([
    post.sourceUrl, post.creatorKey, post.caption, [...post.hashtags].sort(),
    post.publishedAt, post.advertising,
  ]);
  for (const post of posts) {
    const previous = unique.get(post.postId);
    if (previous && evidenceKey(previous) !== evidenceKey(post)) conflicts.add(post.postId);
    else if (!previous) unique.set(post.postId, post);
  }
  return [...unique.values()].filter(post => !conflicts.has(post.postId));
}

export function discoverFashionIdeas(posts: TikTokFashionPost[], context: FashionSampleContext, limit = 3): FashionDiscovery[] {
  const category = categoryForSeed(context.seedTerm);
  if (!contextSchema.safeParse(context).success || !category) return [];
  const vintage = /\bvintage\b/i.test(context.seedTerm);
  const unique = deduplicateEvidence(posts)
    .filter(post => post.advertising !== "flagged" && post.publishedAt >= context.windowStart && post.publishedAt <= context.windowEnd);
  const ideas: FashionDiscovery[] = [];
  for (const { garment, pattern } of category.garments) {
    const matching = unique.filter(post => {
      const text = `${post.caption} ${post.hashtags.join(" ")}`;
      return pattern.test(text) && (!vintage || /vintage/i.test(text));
    });
    const creators = new Set(matching.map(post => post.creatorKey));
    if (creators.size < 2) continue;
    ideas.push({ kind: "sampled_style", garment, searchQuery: vintage ? `vintage ${garment}` : garment,
      postUrls: matching.map(post => post.sourceUrl).sort(), distinctCreators: creators.size,
      label: `Mentioned in ${matching.length} sampled recent posts`,
    });
  }
  return ideas.sort((a, b) => b.distinctCreators - a.distinctCreators || b.postUrls.length - a.postUrls.length || a.garment.localeCompare(b.garment))
    .slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3);
}
