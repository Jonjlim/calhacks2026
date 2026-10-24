import { describe, expect, it } from "vitest";
import { discoverFashionIdeas, normalizeTikTokPosts } from "./tiktok";
import type { FashionSampleContext } from "../contracts";
import recorded from "./fixtures/tiktok-fashion.json";

const end = Date.UTC(2026, 9, 24, 10);
const context: FashionSampleContext = { seedTerm: "vintage denim outfit", windowStart: end - 30 * 86400000, windowEnd: end, retrievedAt: end + 10000 };
// Explicitly synthetic inputs; real source fixtures, when available, are separate.
function post(id: string, creator: string, text = "Vintage denim jacket #denimjacket") {
  return { webVideoUrl: `https://www.tiktok.com/@${creator}/video/${id}?tracking=discard`,
    text, createTimeISO: new Date(end - 86400000).toISOString(),
    playCount: 1000, diggCount: 50, shareCount: 5, isAd: false, isSponsored: false,
    authorMeta: { privateAccount: false, signature: "must not leak", fans: 100000 },
    hashtags: [{ name: "vintage" }, { name: "denimjacket" }],
  };
}

describe("public TikTok normalization", () => {
  it("preserves source/date/count evidence while stripping unrelated author fields and tracking", () => {
    const normalized = normalizeTikTokPosts([post("101", "alice")], context);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ source: "tiktok", sourceUrl: "https://www.tiktok.com/@alice/video/101", creatorKey: "alice", views: 1000, advertising: "not_flagged", retrievedAt: context.retrievedAt });
    expect(normalized[0]).not.toHaveProperty("authorMeta");
    expect(normalized[0]).not.toHaveProperty("fans");
  });

  it("rejects old/future/missing or conflicting dates independently of the actor's date filter", () => {
    const value = post("101", "alice");
    expect(normalizeTikTokPosts([
      { ...value, createTimeISO: new Date(context.windowStart - 1).toISOString() },
      { ...value, createTimeISO: new Date(end + 1).toISOString() },
      { ...value, createTimeISO: undefined },
      { ...value, createTime: Math.floor((end - 10 * 86400000) / 1000) },
      { ...value, createTimeISO: "not a date" },
    ], context)).toEqual([]);
    expect(normalizeTikTokPosts([{ ...value, createTimeISO: undefined, createTime: (end - 86400000) / 1000 }], context)).toHaveLength(1);
  });

  it("rejects private flags, spoofed hosts, credentials and missing IDs; deduplicates video IDs", () => {
    const value = post("101", "alice");
    expect(normalizeTikTokPosts([
      { ...value, authorMeta: { privateAccount: true } },
      { ...value, webVideoUrl: "https://www.tiktok.com.evil.test/@alice/video/101" },
      { ...value, webVideoUrl: "https://token@www.tiktok.com/@alice/video/101" },
      { ...value, webVideoUrl: "https://www.tiktok.com/@alice" },
    ], context)).toEqual([]);
    expect(normalizeTikTokPosts([value, value], context)).toHaveLength(1);
    expect(normalizeTikTokPosts([value, { ...value, webVideoUrl: "https://www.tiktok.com/@renamed/video/101" }], context)).toEqual([]);
  });

  it("drops conflicting duplicate evidence in either order while tolerating counter updates", () => {
    const original = post("101", "alice");
    for (const changed of [
      { ...original, isAd: true },
      { ...original, text: "Vintage outfit #ad" },
      { ...original, webVideoUrl: "https://www.tiktok.com/@bob/video/101" },
      { ...original, createTimeISO: new Date(end - 2 * 86400000).toISOString() },
    ]) {
      expect(normalizeTikTokPosts([original, changed], context)).toEqual([]);
      expect(normalizeTikTokPosts([changed, original], context)).toEqual([]);
    }
    expect(normalizeTikTokPosts([original, { ...original, playCount: 2000 }], context)).toHaveLength(1);
  });

  it("does not coerce counters or convert unknown advertising status to organic", () => {
    const value = post("101", "alice");
    const [normalized] = normalizeTikTokPosts([{ ...value, playCount: "1000000", diggCount: -1, shareCount: Infinity, isSponsored: undefined }], context);
    expect(normalized).not.toHaveProperty("views");
    expect(normalized).not.toHaveProperty("likes");
    expect(normalized).not.toHaveProperty("shares");
    expect(normalized?.advertising).toBe("unknown");
    expect(normalizeTikTokPosts([value], { ...context, retrievedAt: end - 1 })).toEqual([]);
  });

  it("adapts the alternate source without inventing zeros or retaining channel/profile data", () => {
    const value = { postPage: "https://www.tiktok.com/@alice/video/101", title: "Vintage loose jeans", uploadedAtFormatted: new Date(end - 86400000).toISOString(), uploadedAt: (end - 86400000) / 1000,
      views: 0, likes: 120, shares: 0, hashtags: [null, "vintage"], channel: { followers: 10000 }, authorProfile: null };
    const [normalized] = normalizeTikTokPosts([value], context);
    expect(normalized).toMatchObject({ caption: value.title, likes: 120, advertising: "unknown", hashtags: ["vintage"] });
    expect(normalized).not.toHaveProperty("views");
    expect(normalized).not.toHaveProperty("channel");
    expect(normalizeTikTokPosts([{ ...value, authorProfile: { privateAccount: true } }], context)).toEqual([]);
  });
});

describe("caption-based fashion suggestions", () => {
  it("replays the actual source subset with three independent recent mentions and excludes the old post", () => {
    const sampleContext = recorded.context;
    const posts = normalizeTikTokPosts(recorded.data, sampleContext);
    expect(posts).toHaveLength(4); // Three supporting recent posts + one vague recent caption.
    const ideas = discoverFashionIdeas(posts, sampleContext);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ garment: "loose fit jeans", searchQuery: "vintage loose fit jeans", distinctCreators: 3 });
    expect(ideas[0]?.postUrls).toHaveLength(3);
    expect(posts.every(post => post.advertising === "unknown")).toBe(true);
  });

  it("requires two creators and explicit garment mentions; source posts remain attached", () => {
    const posts = normalizeTikTokPosts([post("101", "alice"), post("102", "bob")], context);
    expect(discoverFashionIdeas(posts, context)).toEqual([{ kind: "sampled_style", garment: "denim jacket", searchQuery: "vintage denim jacket", distinctCreators: 2,
      postUrls: ["https://www.tiktok.com/@alice/video/101", "https://www.tiktok.com/@bob/video/102"], label: "Mentioned in 2 sampled recent posts" }]);
    expect(discoverFashionIdeas(posts, context)[0]).not.toHaveProperty("growthPercent");
    expect(discoverFashionIdeas(posts, context)[0]).not.toHaveProperty("trendSignal");
  });

  it("does not count repeated posts or a prolific creator as independent corroboration", () => {
    const posts = normalizeTikTokPosts([post("101", "alice"), post("102", "alice")], context);
    expect(discoverFashionIdeas([...posts, ...posts], context)).toEqual([]);
  });

  it("excludes explicit ads and sponsored hashtags even when engagement is large", () => {
    const a = post("101", "alice");
    const b = post("102", "bob");
    for (const changed of [{ ...b, isAd: true }, { ...b, isSponsored: true }, { ...b, text: b.text + " #ad" }, { ...b, hashtags: [{ name: "sponsored" }] }]) {
      const posts = normalizeTikTokPosts([a, changed], context);
      expect(posts[1]?.advertising).toBe("flagged");
      expect(discoverFashionIdeas(posts, context)).toEqual([]);
    }
  });

  it("does not let duplicate order erase advertising evidence at the discovery boundary", () => {
    const posts = normalizeTikTokPosts([post("101", "alice"), post("102", "bob")], context);
    const conflicting = { ...posts[1]!, advertising: "flagged" as const };
    expect(discoverFashionIdeas([...posts, conflicting], context)).toEqual([]);
    expect(discoverFashionIdeas([conflicting, ...posts], context)).toEqual([]);
  });

  it("does not interpret vague outfit captions or unrelated hashtags as clothing recognition", () => {
    const values = [post("101", "alice", "Vintage outfit"), post("102", "bob", "Vintage outfit")].map(value => ({ ...value, hashtags: [{ name: "ootd" }] }));
    expect(discoverFashionIdeas(normalizeTikTokPosts(values, context), context)).toEqual([]);
  });

  it("matches bounded hashtag patterns, caps results, and keeps output deterministic", () => {
    const values = [post("101", "alice", "Vintage #baggyjeans #widelegjeans #denimskirt"), post("102", "bob", "Vintage #baggyjeans #widelegjeans #denimskirt")]
      .map(value => ({ ...value, hashtags: [] }));
    const posts = normalizeTikTokPosts(values, context);
    expect(discoverFashionIdeas(posts, context).map(row => row.garment)).toEqual(["baggy jeans", "denim skirt", "wide leg jeans"]);
    expect(discoverFashionIdeas([...posts].reverse(), context)).toEqual(discoverFashionIdeas(posts, context));
    expect(discoverFashionIdeas(posts, context, 1)).toHaveLength(1);
    expect(discoverFashionIdeas(posts, context, 0)).toEqual([]);
  });
});

describe("category-scoped vocabulary", () => {
  const jewelry: FashionSampleContext = { ...context, seedTerm: "jewelry outfit" };
  it("finds jewelry directions only for a jewelry seed", () => {
    const values = [post("201", "alice", "Gold hoop earrings and a charm bracelet"), post("202", "bob", "My everyday #hoopearrings stack")]
      .map(row => ({ ...row, hashtags: [] }));
    const posts = normalizeTikTokPosts(values, jewelry);
    expect(discoverFashionIdeas(posts, jewelry).map(row => [row.garment, row.searchQuery])).toEqual([["gold hoop earrings", "gold hoop earrings"]]);
    expect(discoverFashionIdeas(normalizeTikTokPosts(values, context), context)).toEqual([]);
  });
  it("returns nothing for a seed outside the reviewed categories", () => {
    const other = { ...context, seedTerm: "pottery outfit" };
    expect(discoverFashionIdeas(normalizeTikTokPosts([post("301", "alice"), post("302", "bob")], other), other)).toEqual([]);
  });
});
