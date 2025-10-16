#!/usr/bin/env python3
"""
Process social media and advertising data to generate recommendations
for optimal platform and posting times for dermatology products.
"""

import pandas as pd
import json
from datetime import datetime
from collections import defaultdict
import numpy as np

def load_and_clean_data():
    """Load and clean all three CSV datasets."""

    # Load advertising data
    ad_data = pd.read_csv('public/data/Advertising_Data.csv')

    # Load social media engagement data
    social_data = pd.read_csv('public/data/social_media_engagement1.csv')

    # Load marketing sales data
    marketing_data = pd.read_csv('public/data/marketing_sales_data.csv')

    return ad_data, social_data, marketing_data


def analyze_social_media_effectiveness(ad_data):
    """
    Analyze which advertising channels drive the most sales.
    Returns ROI and effectiveness metrics for social media.
    """
    results = {}

    # Calculate ROI for each channel
    channels = ['TV', 'Billboards', 'Google_Ads', 'Social_Media',
                'Influencer_Marketing', 'Affiliate_Marketing']

    for channel in channels:
        total_spend = ad_data[channel].sum()
        total_sales = ad_data['Product_Sold'].sum()
        avg_spend = ad_data[channel].mean()

        # Calculate correlation with sales
        correlation = ad_data[channel].corr(ad_data['Product_Sold'])

        # Calculate effective ROI (sales per dollar spent)
        roi = total_sales / total_spend if total_spend > 0 else 0

        results[channel] = {
            'total_spend': float(total_spend),
            'avg_spend': float(avg_spend),
            'correlation_with_sales': float(correlation),
            'roi': float(roi),
            'total_sales_generated': float(total_sales)
        }

    return results


def analyze_platform_performance(social_data):
    """
    Analyze engagement metrics by platform.
    Calculate total engagement (likes + comments + shares) for each platform.
    """
    platform_stats = {}

    for platform in social_data['platform'].unique():
        platform_posts = social_data[social_data['platform'] == platform]

        # Calculate engagement metrics
        total_likes = platform_posts['likes'].sum()
        total_comments = platform_posts['comments'].sum()
        total_shares = platform_posts['shares'].sum()
        total_engagement = total_likes + total_comments + total_shares

        avg_likes = platform_posts['likes'].mean()
        avg_comments = platform_posts['comments'].mean()
        avg_shares = platform_posts['shares'].mean()

        # Sentiment analysis
        sentiment_counts = platform_posts['sentiment_score'].value_counts().to_dict()

        # Post type analysis
        post_type_performance = {}
        for post_type in platform_posts['post_type'].unique():
            type_posts = platform_posts[platform_posts['post_type'] == post_type]
            post_type_performance[post_type] = {
                'avg_likes': float(type_posts['likes'].mean()),
                'avg_comments': float(type_posts['comments'].mean()),
                'avg_shares': float(type_posts['shares'].mean()),
                'count': int(len(type_posts))
            }

        platform_stats[platform] = {
            'total_engagement': float(total_engagement),
            'avg_likes': float(avg_likes),
            'avg_comments': float(avg_comments),
            'avg_shares': float(avg_shares),
            'post_count': int(len(platform_posts)),
            'sentiment_distribution': sentiment_counts,
            'post_type_performance': post_type_performance
        }

    return platform_stats


def analyze_optimal_posting_times(social_data):
    """
    Analyze engagement by day of week and time of day.
    Returns optimal posting times for each platform.
    """
    optimal_times = {}

    # Parse post_time to extract hour
    social_data['datetime'] = pd.to_datetime(social_data['post_time'], format='%m/%d/%Y %H:%M')
    social_data['hour'] = social_data['datetime'].dt.hour
    social_data['day_of_week'] = social_data['datetime'].dt.day_name()

    for platform in social_data['platform'].unique():
        platform_posts = social_data[social_data['platform'] == platform]

        # Calculate engagement score (weighted sum)
        platform_posts['engagement_score'] = (
            platform_posts['likes'] +
            platform_posts['comments'] * 2 +  # Comments weighted more
            platform_posts['shares'] * 3       # Shares weighted most
        )

        # Group by day of week
        day_performance = platform_posts.groupby('day_of_week').agg({
            'engagement_score': 'mean',
            'likes': 'mean',
            'comments': 'mean',
            'shares': 'mean'
        }).to_dict('index')

        # Find best day
        best_day = max(day_performance.items(), key=lambda x: x[1]['engagement_score'])

        # Group by hour of day
        hour_performance = platform_posts.groupby('hour').agg({
            'engagement_score': 'mean',
            'likes': 'mean',
            'comments': 'mean',
            'shares': 'mean'
        }).to_dict('index')

        # Find best hours (top 3)
        sorted_hours = sorted(hour_performance.items(),
                             key=lambda x: x[1]['engagement_score'],
                             reverse=True)
        best_hours = sorted_hours[:3]

        optimal_times[platform] = {
            'best_day': {
                'day': best_day[0],
                'avg_engagement_score': float(best_day[1]['engagement_score']),
                'avg_likes': float(best_day[1]['likes']),
                'avg_comments': float(best_day[1]['comments']),
                'avg_shares': float(best_day[1]['shares'])
            },
            'best_hours': [
                {
                    'hour': int(hour),
                    'time_range': f"{hour}:00-{hour+1}:00",
                    'avg_engagement_score': float(stats['engagement_score']),
                    'avg_likes': float(stats['likes']),
                    'avg_comments': float(stats['comments']),
                    'avg_shares': float(stats['shares'])
                }
                for hour, stats in best_hours
            ],
            'day_performance': {
                day: {
                    'avg_engagement_score': float(stats['engagement_score']),
                    'avg_likes': float(stats['likes']),
                    'avg_comments': float(stats['comments']),
                    'avg_shares': float(stats['shares'])
                }
                for day, stats in day_performance.items()
            }
        }

    return optimal_times


def analyze_influencer_impact(marketing_data):
    """
    Analyze the impact of different influencer tiers on sales.
    """
    influencer_stats = {}

    for influencer_type in marketing_data['Influencer'].unique():
        influencer_data = marketing_data[marketing_data['Influencer'] == influencer_type]

        influencer_stats[influencer_type] = {
            'avg_sales': float(influencer_data['Sales'].mean()),
            'avg_social_media_spend': float(influencer_data['Social Media'].mean()),
            'count': int(len(influencer_data)),
            'total_sales': float(influencer_data['Sales'].sum())
        }

    return influencer_stats


def generate_recommendations(ad_effectiveness, platform_performance,
                            optimal_times, influencer_impact):
    """
    Generate actionable recommendations based on the analysis.
    """

    # Rank platforms by total engagement
    platform_ranking = sorted(
        platform_performance.items(),
        key=lambda x: x[1]['total_engagement'],
        reverse=True
    )

    # Get top platform
    top_platform = platform_ranking[0]

    # Get social media ROI from advertising data
    social_media_roi = ad_effectiveness.get('Social_Media', {}).get('roi', 0)
    influencer_roi = ad_effectiveness.get('Influencer_Marketing', {}).get('roi', 0)

    # Rank influencer types by average sales
    influencer_ranking = sorted(
        influencer_impact.items(),
        key=lambda x: x[1]['avg_sales'],
        reverse=True
    )

    recommendations = {
        'primary_platform': {
            'name': top_platform[0],
            'total_engagement': top_platform[1]['total_engagement'],
            'avg_engagement': {
                'likes': top_platform[1]['avg_likes'],
                'comments': top_platform[1]['avg_comments'],
                'shares': top_platform[1]['avg_shares']
            },
            'justification': f"{top_platform[0]} has the highest total engagement with {top_platform[1]['total_engagement']:.0f} total interactions across {top_platform[1]['post_count']} posts."
        },
        'platform_rankings': [
            {
                'rank': idx + 1,
                'platform': name,
                'total_engagement': stats['total_engagement'],
                'avg_likes': stats['avg_likes'],
                'avg_comments': stats['avg_comments'],
                'avg_shares': stats['avg_shares']
            }
            for idx, (name, stats) in enumerate(platform_ranking)
        ],
        'optimal_posting': optimal_times.get(top_platform[0], {}),
        'content_recommendations': {
            'best_post_types': platform_performance[top_platform[0]]['post_type_performance']
        },
        'influencer_strategy': {
            'top_performer': {
                'type': influencer_ranking[0][0],
                'avg_sales': influencer_ranking[0][1]['avg_sales'],
                'justification': f"{influencer_ranking[0][0]} influencers drive the highest average sales of ${influencer_ranking[0][1]['avg_sales']:.2f}"
            },
            'all_tiers': [
                {
                    'rank': idx + 1,
                    'type': tier,
                    'avg_sales': stats['avg_sales'],
                    'avg_spend': stats['avg_social_media_spend']
                }
                for idx, (tier, stats) in enumerate(influencer_ranking)
            ]
        },
        'budget_allocation': {
            'social_media_roi': social_media_roi,
            'influencer_marketing_roi': influencer_roi,
            'recommendation': 'Focus on Influencer Marketing' if influencer_roi > social_media_roi else 'Balance between Social Media and Influencer Marketing'
        }
    }

    return recommendations


def main():
    """Main processing function."""
    print("Loading data...")
    ad_data, social_data, marketing_data = load_and_clean_data()

    print("Analyzing advertising effectiveness...")
    ad_effectiveness = analyze_social_media_effectiveness(ad_data)

    print("Analyzing platform performance...")
    platform_performance = analyze_platform_performance(social_data)

    print("Analyzing optimal posting times...")
    optimal_times = analyze_optimal_posting_times(social_data)

    print("Analyzing influencer impact...")
    influencer_impact = analyze_influencer_impact(marketing_data)

    print("Generating recommendations...")
    recommendations = generate_recommendations(
        ad_effectiveness,
        platform_performance,
        optimal_times,
        influencer_impact
    )

    # Compile all results
    output = {
        'generated_at': datetime.now().isoformat(),
        'recommendations': recommendations,
        'detailed_analysis': {
            'advertising_effectiveness': ad_effectiveness,
            'platform_performance': platform_performance,
            'optimal_posting_times': optimal_times,
            'influencer_impact': influencer_impact
        }
    }

    # Save to JSON file
    output_path = 'public/data/social_media_recommendations.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ Analysis complete! Results saved to {output_path}")
    print(f"\nTop Recommendation:")
    print(f"  Platform: {recommendations['primary_platform']['name']}")
    print(f"  Best Day: {recommendations['optimal_posting']['best_day']['day']}")
    print(f"  Best Hours: {', '.join([h['time_range'] for h in recommendations['optimal_posting']['best_hours']])}")
    print(f"  Influencer Strategy: {recommendations['influencer_strategy']['top_performer']['type']}")


if __name__ == '__main__':
    main()
