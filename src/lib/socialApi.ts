// src/lib/socialApi.ts

import type {
  SocialBrand,
  SocialInfluencer,
  SocialHashtag,
  PlatformSentiment,
} from "../config";

// ========== MOCK DATA FOR LOCAL TESTING ==========
const USE_MOCK_DATA = false; // Set to false when backend is ready
const API_BASE = "https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com";
const MOCK_BRANDS: SocialBrand[] = [
  {
    brand: "CeraVe",
    mention_count: 245,
    total_engagement: 15420,
    sentiment: { positive: 72, negative: 10, neutral: 18 },
    platforms: { instagram: 180, tiktok: 65 },
  },
  {
    brand: "The Ordinary",
    mention_count: 198,
    total_engagement: 12350,
    sentiment: { positive: 68, negative: 15, neutral: 17 },
    platforms: { instagram: 150, tiktok: 48 },
  },
  {
    brand: "Glossier",
    mention_count: 156,
    total_engagement: 9840,
    sentiment: { positive: 75, negative: 8, neutral: 17 },
    platforms: { instagram: 120, tiktok: 36 },
  },
];

const MOCK_INFLUENCERS: SocialInfluencer[] = [
  {
    handle: "beautyguru_sg",
    posts: 12,
    avg_engagement: 2450,
    influence_score: 8750,
    products_mentioned: ["Serum", "Moisturizer", "Sunscreen"],
    brands_mentioned: ["CeraVe", "The Ordinary"],
    top_hashtags: ["skincare", "kbeauty", "glowingskin"],
    platforms: ["instagram"],
  },
  {
    handle: "skincare_addict",
    posts: 8,
    avg_engagement: 1820,
    influence_score: 6240,
    products_mentioned: ["Cleanser", "Toner"],
    brands_mentioned: ["Glossier", "Fenty"],
    top_hashtags: ["skincareroutine", "beautytips"],
    platforms: ["instagram", "tiktok"],
  },
];

const MOCK_HASHTAGS: SocialHashtag[] = [
  { hashtag: "#skincare", post_count: 342, total_engagement: 45200, avg_engagement: 132 },
  { hashtag: "#kbeauty", post_count: 256, total_engagement: 38400, avg_engagement: 150 },
  { hashtag: "#glowingskin", post_count: 198, total_engagement: 28560, avg_engagement: 144 },
  { hashtag: "#skincareroutine", post_count: 176, total_engagement: 24320, avg_engagement: 138 },
];

const MOCK_SENTIMENT: Record<string, PlatformSentiment> = {
  instagram: {
    positive: 420,
    negative: 58,
    neutral: 122,
    total: 600,
    positive_pct: 70.0,
    negative_pct: 9.7,
    neutral_pct: 20.3,
  },
  tiktok: {
    positive: 145,
    negative: 35,
    neutral: 70,
    total: 250,
    positive_pct: 58.0,
    negative_pct: 14.0,
    neutral_pct: 28.0,
  },
};

// ========== API FUNCTIONS ==========

export async function fetchBrands(
  token: string,
  limit = 10
): Promise<{ brands: SocialBrand[] }> {
  if (USE_MOCK_DATA) {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { brands: MOCK_BRANDS.slice(0, limit) };
  }

  const response = await fetch(
    `${API_BASE}/social/brands?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch brands: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchInfluencers(
  token: string,
  limit = 10
): Promise<{ influencers: SocialInfluencer[] }> {
  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { influencers: MOCK_INFLUENCERS.slice(0, limit) };
  }

  const response = await fetch(
    `${API_BASE}/social/influencers?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch influencers: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchHashtags(
  token: string,
  limit = 20
): Promise<{ hashtags: SocialHashtag[] }> {
  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { hashtags: MOCK_HASHTAGS.slice(0, limit) };
  }

  const response = await fetch(
    `${API_BASE}/social/hashtags?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch hashtags: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchSentimentByPlatform(
  token: string
): Promise<{ platforms: Record<string, PlatformSentiment> }> {
  if (USE_MOCK_DATA) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { platforms: MOCK_SENTIMENT };
  }

  const response = await fetch(
    `${API_BASE}/social/sentiment`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sentiment by platform: ${response.statusText}`
    );
  }

  return response.json();
}