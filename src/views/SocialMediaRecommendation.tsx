// src/views/SocialMediaRecommendation.tsx
import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from "recharts";
import { useJson } from "../hooks";

type SocialMediaRecommendationData = {
  generated_at: string;
  recommendations: {
    primary_platform: {
      name: string;
      total_engagement: number;
      avg_engagement: {
        likes: number;
        comments: number;
        shares: number;
      };
      justification: string;
    };
    platform_rankings: Array<{
      rank: number;
      platform: string;
      total_engagement: number;
      avg_likes: number;
      avg_comments: number;
      avg_shares: number;
    }>;
    optimal_posting: {
      best_day: {
        day: string;
        avg_engagement_score: number;
        avg_likes: number;
        avg_comments: number;
        avg_shares: number;
      };
      best_hours: Array<{
        hour: number;
        time_range: string;
        avg_engagement_score: number;
        avg_likes: number;
        avg_comments: number;
        avg_shares: number;
      }>;
      day_performance: Record<
        string,
        {
          avg_engagement_score: number;
          avg_likes: number;
          avg_comments: number;
          avg_shares: number;
        }
      >;
    };
    content_recommendations: {
      best_post_types: Record<
        string,
        {
          avg_likes: number;
          avg_comments: number;
          avg_shares: number;
          count: number;
        }
      >;
    };
    influencer_strategy: {
      top_performer: {
        type: string;
        avg_sales: number;
        justification: string;
      };
      all_tiers: Array<{
        rank: number;
        type: string;
        avg_sales: number;
        avg_spend: number;
      }>;
    };
    budget_allocation: {
      social_media_roi: number;
      influencer_marketing_roi: number;
      recommendation: string;
    };
  };
};

function KeyFindingsCard({
  title,
  items,
  footnote,
}: {
  title: string;
  items: Array<string | React.ReactNode>;
  footnote?: React.ReactNode;
}) {
  return (
    <aside className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-4 shadow-sm">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <ul className="space-y-2 text-sm leading-5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[6px] h-[6px] w-[6px] rounded-full bg-gray-400 shrink-0" />
            <span className="text-gray-700">{it}</span>
          </li>
        ))}
      </ul>
      {footnote && <div className="mt-3 text-xs text-gray-500">{footnote}</div>}
    </aside>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  color = "blue",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "blue" | "green" | "purple" | "orange";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-900 border-blue-200",
    green: "bg-green-50 text-green-900 border-green-200",
    purple: "bg-purple-50 text-purple-900 border-purple-200",
    orange: "bg-orange-50 text-orange-900 border-orange-200",
  };

  return (
    <div
      className={`rounded-xl border p-4 ${colorClasses[color]} transition hover:shadow-md`}
    >
      <div className="text-xs font-medium opacity-70 mb-1">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && <div className="text-xs opacity-70 mt-1">{subtitle}</div>}
    </div>
  );
}

export default function SocialMediaRecommendation() {
  const { data, loading, error } =
    useJson<SocialMediaRecommendationData>(
      "https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev/spirulina-dev-social-media-recommendation"
    );

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-gray-500">Loading recommendations...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <div className="font-semibold text-red-900">Error loading data</div>
        <div className="mt-1 text-sm text-red-700">
          {error || "No data available"}
        </div>
      </div>
    );
  }

  const { recommendations } = data;

  // Prepare data for charts
  const platformComparisonData = recommendations.platform_rankings.map((p) => ({
    platform: p.platform,
    likes: Math.round(p.avg_likes),
    comments: Math.round(p.avg_comments),
    shares: Math.round(p.avg_shares),
    total: Math.round(p.total_engagement),
  }));

  const dayPerformanceData = Object.entries(
    recommendations.optimal_posting.day_performance
  )
    .map(([day, stats]) => ({
      day,
      engagement: Math.round(stats.avg_engagement_score),
      likes: Math.round(stats.avg_likes),
      comments: Math.round(stats.avg_comments),
      shares: Math.round(stats.avg_shares),
    }))
    .sort((a, b) => {
      const dayOrder = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];
      return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    });

  const hourPerformanceData = recommendations.optimal_posting.best_hours.map(
    (h) => ({
      time: h.time_range,
      engagement: Math.round(h.avg_engagement_score),
      likes: Math.round(h.avg_likes),
      comments: Math.round(h.avg_comments),
      shares: Math.round(h.avg_shares),
    })
  );

  const postTypeData = Object.entries(
    recommendations.content_recommendations.best_post_types
  ).map(([type, stats]) => ({
    type,
    avgLikes: Math.round(stats.avg_likes),
    avgComments: Math.round(stats.avg_comments),
    avgShares: Math.round(stats.avg_shares),
    count: stats.count,
  }));

  const influencerData = recommendations.influencer_strategy.all_tiers.map(
    (tier) => ({
      type: tier.type,
      avgSales: Math.round(tier.avg_sales),
      avgSpend: Math.round(tier.avg_spend),
    })
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold mb-2">
          Social Media Marketing Recommendations
        </h1>
        <p className="text-sm text-gray-600">
          Data-driven insights for optimal social media strategy and posting
          times for dermatology products
        </p>
      </div>

      {/* Key Recommendations */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Recommended Platform"
          value={recommendations.primary_platform.name}
          subtitle={`${Math.round(recommendations.primary_platform.total_engagement).toLocaleString()} total engagements`}
          color="blue"
        />
        <MetricCard
          title="Best Day to Post"
          value={recommendations.optimal_posting.best_day.day}
          subtitle={`${Math.round(recommendations.optimal_posting.best_day.avg_engagement_score).toLocaleString()} avg engagement`}
          color="green"
        />
        <MetricCard
          title="Optimal Time"
          value={recommendations.optimal_posting.best_hours[0].time_range}
          subtitle="Highest engagement window"
          color="purple"
        />
        <MetricCard
          title="Top Influencer Tier"
          value={recommendations.influencer_strategy.top_performer.type}
          subtitle={`$${Math.round(recommendations.influencer_strategy.top_performer.avg_sales).toLocaleString()} avg sales`}
          color="orange"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left Column - Charts */}
        <div className="space-y-4 lg:col-span-2">
          {/* Platform Comparison Chart */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">
              Platform Performance Comparison
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={platformComparisonData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="platform" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="likes" fill="#3b82f6" name="Avg Likes" />
                <Bar dataKey="comments" fill="#10b981" name="Avg Comments" />
                <Bar dataKey="shares" fill="#f59e0b" name="Avg Shares" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 text-sm text-gray-600">
              {recommendations.primary_platform.justification}
            </div>
          </div>

          {/* Day of Week Performance */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">
              Engagement by Day of Week
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dayPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="engagement"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  name="Engagement Score"
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 text-sm text-gray-600">
              {recommendations.optimal_posting.best_day.day} shows the highest
              engagement score with an average of{" "}
              {Math.round(
                recommendations.optimal_posting.best_day.avg_engagement_score
              ).toLocaleString()}{" "}
              points.
            </div>
          </div>

          {/* Best Posting Hours */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">
              Top 3 Posting Time Windows
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="engagement"
                  fill="#8b5cf6"
                  name="Engagement Score"
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 text-sm text-gray-600">
              The time window{" "}
              {recommendations.optimal_posting.best_hours[0].time_range} shows
              peak engagement. Consider posting during these hours for maximum
              reach.
            </div>
          </div>

          {/* Post Type Performance */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">
              Content Type Performance on {recommendations.primary_platform.name}
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={postTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="avgLikes" fill="#3b82f6" name="Avg Likes" />
                <Bar dataKey="avgComments" fill="#10b981" name="Avg Comments" />
                <Bar dataKey="avgShares" fill="#f59e0b" name="Avg Shares" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 text-sm text-gray-600">
              Different content types perform differently. Use this data to
              optimize your content strategy.
            </div>
          </div>

          {/* Influencer Tier Performance */}
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">
              Influencer Tier Performance
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={influencerData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="avgSales" fill="#10b981" name="Avg Sales ($)" />
                <Bar
                  dataKey="avgSpend"
                  fill="#f59e0b"
                  name="Avg Spend ($)"
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 text-sm text-gray-600">
              {recommendations.influencer_strategy.top_performer.justification}
            </div>
          </div>
        </div>

        {/* Right Column - Key Findings */}
        <div className="space-y-4">
          <KeyFindingsCard
            title="Platform Strategy"
            items={[
              <>
                <strong>{recommendations.primary_platform.name}</strong> is the
                top platform with{" "}
                {Math.round(
                  recommendations.primary_platform.total_engagement
                ).toLocaleString()}{" "}
                total engagements
              </>,
              <>
                Average{" "}
                <strong>
                  {Math.round(
                    recommendations.primary_platform.avg_engagement.likes
                  ).toLocaleString()}
                </strong>{" "}
                likes per post
              </>,
              <>
                Average{" "}
                <strong>
                  {Math.round(
                    recommendations.primary_platform.avg_engagement.comments
                  ).toLocaleString()}
                </strong>{" "}
                comments per post
              </>,
              <>
                Average{" "}
                <strong>
                  {Math.round(
                    recommendations.primary_platform.avg_engagement.shares
                  ).toLocaleString()}
                </strong>{" "}
                shares per post
              </>,
            ]}
          />

          <KeyFindingsCard
            title="Timing Recommendations"
            items={[
              <>
                Best day: <strong>{recommendations.optimal_posting.best_day.day}</strong>
              </>,
              <>
                Peak time:{" "}
                <strong>
                  {recommendations.optimal_posting.best_hours[0].time_range}
                </strong>
              </>,
              <>
                Alternative times:{" "}
                <strong>
                  {recommendations.optimal_posting.best_hours
                    .slice(1)
                    .map((h) => h.time_range)
                    .join(", ")}
                </strong>
              </>,
              "Post during early morning hours (2-5 AM) for maximum engagement",
            ]}
            footnote="Times based on historical engagement patterns"
          />

          <KeyFindingsCard
            title="Content Strategy"
            items={Object.entries(
              recommendations.content_recommendations.best_post_types
            )
              .sort((a, b) => {
                const aTotal =
                  a[1].avg_likes + a[1].avg_comments * 2 + a[1].avg_shares * 3;
                const bTotal =
                  b[1].avg_likes + b[1].avg_comments * 2 + b[1].avg_shares * 3;
                return bTotal - aTotal;
              })
              .slice(0, 4)
              .map(([type, stats]) => (
                <>
                  <strong className="capitalize">{type}</strong> posts: Avg{" "}
                  {Math.round(stats.avg_likes)} likes, {Math.round(stats.avg_comments)}{" "}
                  comments, {Math.round(stats.avg_shares)} shares
                </>
              ))}
            footnote={`Based on ${recommendations.primary_platform.name} performance data`}
          />

          <KeyFindingsCard
            title="Influencer Partnership"
            items={[
              recommendations.influencer_strategy.top_performer.justification,
              <>
                Budget allocation:{" "}
                <strong>{recommendations.budget_allocation.recommendation}</strong>
              </>,
              <>
                Social Media ROI:{" "}
                <strong>
                  {recommendations.budget_allocation.social_media_roi.toFixed(2)}
                </strong>
              </>,
              <>
                Influencer Marketing ROI:{" "}
                <strong>
                  {recommendations.budget_allocation.influencer_marketing_roi.toFixed(
                    2
                  )}
                </strong>
              </>,
            ]}
            footnote="ROI calculated as total sales per dollar spent"
          />

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-sm font-semibold text-blue-900 mb-2">
              Quick Action Items
            </div>
            <ul className="space-y-1 text-sm text-blue-800">
              <li className="flex gap-2">
                <span>1.</span>
                <span>
                  Focus {recommendations.primary_platform.name} marketing efforts
                </span>
              </li>
              <li className="flex gap-2">
                <span>2.</span>
                <span>
                  Schedule posts for {recommendations.optimal_posting.best_day.day} at{" "}
                  {recommendations.optimal_posting.best_hours[0].time_range}
                </span>
              </li>
              <li className="flex gap-2">
                <span>3.</span>
                <span>
                  Partner with {recommendations.influencer_strategy.top_performer.type}{" "}
                  influencers
                </span>
              </li>
              <li className="flex gap-2">
                <span>4.</span>
                <span>
                  Prioritize{" "}
                  {
                    Object.entries(
                      recommendations.content_recommendations.best_post_types
                    ).sort((a, b) => {
                      const aTotal =
                        a[1].avg_likes +
                        a[1].avg_comments * 2 +
                        a[1].avg_shares * 3;
                      const bTotal =
                        b[1].avg_likes +
                        b[1].avg_comments * 2 +
                        b[1].avg_shares * 3;
                      return bTotal - aTotal;
                    })[0][0]
                  }{" "}
                  content format
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
