export const ASPECT_CONFIG = {
  SUMMARY_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspects_summary.json",
  TOP_TERMS_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspect_top_terms.json",
  BUNDLE_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspects_bundle.json",
};

export const CONFIG = {
  API_BASE: "https://d44acqkdpe03w.cloudfront.net",
  WS_BASE: "https://d1n59ypscvrsxd.cloudfront.net/production",
};

export const COGNITO = {
  domain: "spirulina.auth.us-east-1.amazoncognito.com",
  clientId: "oh2vf9imle1l56nkk6fmkte0i",
  redirectUri: "https://d29cblcrtk6lh8.cloudfront.net/",
  scopes: ["openid", "email"],
  useIdToken: true,
};

export type SocialBrand = {
  brand: string;
  mention_count: number;
  total_engagement: number;
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
  };
  platforms: Record<string, number>;
};

export type SocialInfluencer = {
  handle: string;
  posts: number;
  avg_engagement: number;
  influence_score: number;
  products_mentioned: string[];
  brands_mentioned: string[];
  top_hashtags: string[];
  platforms: string[];
};

export type SocialHashtag = {
  hashtag: string;
  post_count: number;
  total_engagement: number;
  avg_engagement: number;
};

export type PlatformSentiment = {
  positive: number;
  negative: number;
  neutral: number;
  total: number;
  positive_pct: number;
  negative_pct: number;
  neutral_pct: number;
};
