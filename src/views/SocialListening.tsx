// src/views/SocialListening.tsx
import React from "react";
import { useAuth } from "../contexts";
import {
  fetchBrands,
  fetchInfluencers,
  fetchHashtags,
  fetchSentimentByPlatform,
} from "../lib/socialApi";
import type {
  SocialBrand,
  SocialInfluencer,
  SocialHashtag,
  PlatformSentiment,
} from "../config";
import SocialMediaRecommendation from "./SocialMediaRecommendation";

type SocialData = {
  brands: SocialBrand[];
  influencers: SocialInfluencer[];
  hashtags: SocialHashtag[];
  sentiment: Record<string, PlatformSentiment>;
};

export default function SocialListening() {
  const { token } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<SocialData>({
    brands: [],
    influencers: [],
    hashtags: [],
    sentiment: {},
  });

  const loadData = React.useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const [brandsRes, influencersRes, hashtagsRes, sentimentRes] =
        await Promise.all([
          fetchBrands(token, 10),
          fetchInfluencers(token, 10),
          fetchHashtags(token, 20),
          fetchSentimentByPlatform(token),
        ]);

      setData({
        brands: brandsRes.brands,
        influencers: influencersRes.influencers,
        hashtags: hashtagsRes.hashtags,
        sentiment: sentimentRes.platforms,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Error loading social listening data:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-gray-500">Loading social insights...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-2 text-lg font-semibold text-red-600">
          Error Loading Data
        </div>
        <div className="text-sm text-gray-600">{error}</div>
        <button
          onClick={loadData}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Social Listening</h1>
        <button
          onClick={loadData}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* 2x2 Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Card 1: Brand Mentions */}
        <BrandMentionsCard brands={data.brands} />

        {/* Card 2: Sentiment by Platform */}
        <SentimentCard sentiment={data.sentiment} />

        {/* Card 3: Top Influencers */}
        <InfluencersCard influencers={data.influencers} />

        {/* Card 4: Trending Hashtags */}
        <HashtagsCard hashtags={data.hashtags} />
      </div>

      {/* Social Media Recommendations Section */}
      <div className="mt-6">
        <SocialMediaRecommendation />
      </div>
    </div>
  );
}

// ========== SUB-COMPONENTS ==========

function BrandMentionsCard({ brands }: { brands: SocialBrand[] }) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Brand Mentions</h2>

      <div className="space-y-3">
        {brands.slice(0, 8).map((brand, idx) => (
          <div key={idx} className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium">{brand.brand}</div>
              <div className="text-xs text-gray-500">
                {brand.mention_count} mentions •{" "}
                {brand.total_engagement.toLocaleString()} engagement
              </div>
            </div>

            <div
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                brand.sentiment.positive > 60
                  ? "bg-green-100 text-green-800"
                  : brand.sentiment.positive > 40
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {brand.sentiment.positive.toFixed(0)}% ✓
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SentimentCard({
  sentiment,
}: {
  sentiment: Record<string, PlatformSentiment>;
}) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Sentiment by Platform</h2>

      <div className="space-y-4">
        {Object.entries(sentiment).map(([platform, stats]) => (
          <div key={platform}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{platform}</span>
              <span className="text-gray-500">{stats.total} posts</span>
            </div>

            {/* Stacked bar */}
            <div className="flex h-6 overflow-hidden rounded-full bg-gray-100">
              <div
                className="bg-green-500"
                style={{ width: `${stats.positive_pct}%` }}
                title={`${stats.positive_pct.toFixed(1)}% positive`}
              />
              <div
                className="bg-gray-400"
                style={{ width: `${stats.neutral_pct}%` }}
                title={`${stats.neutral_pct.toFixed(1)}% neutral`}
              />
              <div
                className="bg-red-500"
                style={{ width: `${stats.negative_pct}%` }}
                title={`${stats.negative_pct.toFixed(1)}% negative`}
              />
            </div>

            <div className="mt-1 flex gap-3 text-xs text-gray-600">
              <span>✓ {stats.positive_pct.toFixed(0)}%</span>
              <span>~ {stats.neutral_pct.toFixed(0)}%</span>
              <span>✗ {stats.negative_pct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfluencersCard({
  influencers,
}: {
  influencers: SocialInfluencer[];
}) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Top Influencers</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2 font-medium">#</th>
              <th className="pb-2 font-medium">Handle</th>
              <th className="pb-2 text-right font-medium">Posts</th>
              <th className="pb-2 text-right font-medium">Avg Eng.</th>
              <th className="pb-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {influencers.slice(0, 8).map((inf, idx) => (
              <tr key={idx} className="border-b last:border-0">
                <td className="py-2 text-gray-400">#{idx + 1}</td>
                <td className="py-2 font-medium">@{inf.handle}</td>
                <td className="py-2 text-right">{inf.posts}</td>
                <td className="py-2 text-right">
                  {inf.avg_engagement.toLocaleString()}
                </td>
                <td className="py-2 text-right font-semibold text-blue-600">
                  {inf.influence_score.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {influencers[0]?.products_mentioned?.length > 0 && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs">
          <div className="font-medium text-gray-700">
            Top influencer mentions:
          </div>
          <div className="mt-1 text-gray-600">
            {influencers[0].products_mentioned.slice(0, 3).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}

function HashtagsCard({ hashtags }: { hashtags: SocialHashtag[] }) {
  const maxEngagement = Math.max(
    ...hashtags.map((h) => h.total_engagement),
    1
  );

  const getFontSize = (engagement: number) => {
    const ratio = engagement / maxEngagement;
    return 12 + ratio * 20; // 12px to 32px
  };

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Trending Hashtags</h2>

      <div className="flex min-h-[280px] flex-wrap items-center justify-center gap-3">
        {hashtags.slice(0, 30).map((tag, idx) => (
          <div
            key={idx}
            className="cursor-pointer transition-opacity hover:opacity-70"
            style={{
              fontSize: `${getFontSize(tag.total_engagement)}px`,
              color: `hsl(${200 + idx * 4}, 70%, 50%)`,
            }}
            title={`${tag.post_count} posts • ${tag.total_engagement.toLocaleString()} engagement`}
          >
            {tag.hashtag}
          </div>
        ))}
      </div>

      <div className="mt-3 border-t pt-3 text-center text-xs text-gray-500">
        Size indicates engagement level • Hover for details
      </div>
    </div>
  );
}