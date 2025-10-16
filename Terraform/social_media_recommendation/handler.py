#!/usr/bin/env python3
"""
Lambda handler for social media recommendation processing.
Analyzes advertising, social media engagement, and marketing sales data
to generate actionable recommendations for dermatology product campaigns.

Triggered via API Gateway POST /social-media/recommendations
Returns JSON with platform, timing, and influencer recommendations.
"""

import os
import json
import logging
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Any
import boto3
import pymysql
import pandas as pd
import numpy as np

# ===== CONFIGURATION =====
logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
SECRET_ARN = os.environ["DB_SECRET_ARN"]
S3_BUCKET = os.getenv("S3_DATA_BUCKET", "spiruvita-data")
S3_PREFIX = os.getenv("S3_DATA_PREFIX", "social-media/")

# CSV file names
ADVERTISING_CSV = "Advertising_Data.csv"
SOCIAL_ENGAGEMENT_CSV = "social_media_engagement1.csv"
MARKETING_SALES_CSV = "marketing_sales_data.csv"


# ===== UTILITY FUNCTIONS =====
def _json_default(obj):
    """JSON serializer for objects not serializable by default json module."""
    if isinstance(obj, (datetime, pd.Timestamp)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if pd.isna(obj):
        return None
    return str(obj)


def _cors_headers():
    """Standard CORS headers for API Gateway responses."""
    return {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
    }


def _load_db_config():
    """Load RDS credentials from AWS Secrets Manager."""
    sm = boto3.client("secretsmanager", region_name=REGION)
    secret = sm.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    config = json.loads(secret)
    return {
        "host": config["host"],
        "user": config["username"],
        "password": config["password"],
        "database": config.get("database", config.get("dbname", "spiruvita")),
        "port": int(config.get("port", 3306)),
        "connect_timeout": 10,
        "charset": "utf8mb4",
        "autocommit": True,
        "cursorclass": pymysql.cursors.DictCursor,
    }


def _get_db_connection():
    """Establish connection to RDS MySQL database."""
    return pymysql.connect(**_load_db_config())


def _load_csv_from_s3(bucket: str, key: str) -> pd.DataFrame:
    """Load CSV file from S3 into pandas DataFrame."""
    s3 = boto3.client("s3", region_name=REGION)
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        df = pd.read_csv(obj["Body"])
        logger.info(f"Loaded {key}: {len(df)} rows, {len(df.columns)} columns")
        return df
    except Exception as e:
        logger.error(f"Failed to load {key} from S3: {e}")
        raise


# ===== DATA ANALYSIS FUNCTIONS =====
def analyze_advertising_effectiveness(ad_data: pd.DataFrame) -> Dict[str, Any]:
    """
    Analyze ROI and correlation with sales for each advertising channel.

    Args:
        ad_data: DataFrame with columns: TV, Billboards, Google_Ads,
                 Social_Media, Influencer_Marketing, Affiliate_Marketing, Product_Sold

    Returns:
        Dictionary with channel-level ROI and correlation metrics
    """
    channels = [
        "TV", "Billboards", "Google_Ads", "Social_Media",
        "Influencer_Marketing", "Affiliate_Marketing"
    ]

    results = {}
    total_sales = ad_data["Product_Sold"].sum()

    for channel in channels:
        if channel not in ad_data.columns:
            logger.warning(f"Channel {channel} not found in advertising data")
            continue

        total_spend = ad_data[channel].sum()
        avg_spend = ad_data[channel].mean()
        correlation = ad_data[channel].corr(ad_data["Product_Sold"])
        roi = total_sales / total_spend if total_spend > 0 else 0

        results[channel] = {
            "total_spend": float(total_spend),
            "avg_spend": float(avg_spend),
            "correlation_with_sales": float(correlation) if not pd.isna(correlation) else 0,
            "roi": float(roi),
        }

    logger.info(f"Analyzed {len(results)} advertising channels")
    return results


def analyze_platform_performance(social_data: pd.DataFrame) -> Dict[str, Any]:
    """
    Analyze engagement metrics by social media platform.

    Args:
        social_data: DataFrame with columns: platform, likes, comments, shares,
                     sentiment_score, post_type

    Returns:
        Dictionary with platform-level engagement statistics
    """
    platform_stats = {}

    for platform in social_data["platform"].unique():
        platform_posts = social_data[social_data["platform"] == platform]

        # Aggregate engagement metrics
        total_likes = platform_posts["likes"].sum()
        total_comments = platform_posts["comments"].sum()
        total_shares = platform_posts["shares"].sum()
        total_engagement = total_likes + total_comments + total_shares

        # Post type breakdown
        post_type_performance = {}
        for post_type in platform_posts["post_type"].unique():
            type_posts = platform_posts[platform_posts["post_type"] == post_type]
            post_type_performance[post_type] = {
                "avg_likes": float(type_posts["likes"].mean()),
                "avg_comments": float(type_posts["comments"].mean()),
                "avg_shares": float(type_posts["shares"].mean()),
                "count": int(len(type_posts)),
            }

        platform_stats[platform] = {
            "total_engagement": float(total_engagement),
            "avg_likes": float(platform_posts["likes"].mean()),
            "avg_comments": float(platform_posts["comments"].mean()),
            "avg_shares": float(platform_posts["shares"].mean()),
            "post_count": int(len(platform_posts)),
            "post_type_performance": post_type_performance,
        }

    logger.info(f"Analyzed {len(platform_stats)} platforms")
    return platform_stats


def analyze_optimal_posting_times(social_data: pd.DataFrame) -> Dict[str, Any]:
    """
    Determine best days and hours for posting based on engagement patterns.

    Args:
        social_data: DataFrame with columns: platform, post_time, likes, comments, shares

    Returns:
        Dictionary with optimal timing recommendations per platform
    """
    # Parse datetime
    social_data["datetime"] = pd.to_datetime(social_data["post_time"], format="%m/%d/%Y %H:%M")
    social_data["hour"] = social_data["datetime"].dt.hour
    social_data["day_of_week"] = social_data["datetime"].dt.day_name()

    # Calculate weighted engagement score
    social_data["engagement_score"] = (
        social_data["likes"] +
        social_data["comments"] * 2 +  # Comments weighted higher
        social_data["shares"] * 3      # Shares weighted highest
    )

    optimal_times = {}

    for platform in social_data["platform"].unique():
        platform_posts = social_data[social_data["platform"] == platform]

        # Day of week analysis
        day_performance = platform_posts.groupby("day_of_week").agg({
            "engagement_score": "mean",
            "likes": "mean",
            "comments": "mean",
            "shares": "mean",
        }).to_dict("index")

        best_day = max(day_performance.items(), key=lambda x: x[1]["engagement_score"])

        # Hour of day analysis
        hour_performance = platform_posts.groupby("hour").agg({
            "engagement_score": "mean",
            "likes": "mean",
            "comments": "mean",
            "shares": "mean",
        }).to_dict("index")

        # Top 3 hours
        sorted_hours = sorted(
            hour_performance.items(),
            key=lambda x: x[1]["engagement_score"],
            reverse=True
        )[:3]

        optimal_times[platform] = {
            "best_day": {
                "day": best_day[0],
                "avg_engagement_score": float(best_day[1]["engagement_score"]),
                "avg_likes": float(best_day[1]["likes"]),
                "avg_comments": float(best_day[1]["comments"]),
                "avg_shares": float(best_day[1]["shares"]),
            },
            "best_hours": [
                {
                    "hour": int(hour),
                    "time_range": f"{int(hour):02d}:00-{int(hour)+1:02d}:00",
                    "avg_engagement_score": float(stats["engagement_score"]),
                    "avg_likes": float(stats["likes"]),
                    "avg_comments": float(stats["comments"]),
                    "avg_shares": float(stats["shares"]),
                }
                for hour, stats in sorted_hours
            ],
            "day_performance": {
                day: {
                    "avg_engagement_score": float(stats["engagement_score"]),
                    "avg_likes": float(stats["likes"]),
                    "avg_comments": float(stats["comments"]),
                    "avg_shares": float(stats["shares"]),
                }
                for day, stats in day_performance.items()
            },
        }

    logger.info(f"Analyzed optimal times for {len(optimal_times)} platforms")
    return optimal_times


def analyze_influencer_impact(marketing_data: pd.DataFrame) -> Dict[str, Any]:
    """
    Analyze sales performance by influencer tier.

    Args:
        marketing_data: DataFrame with columns: Influencer, Sales, Social Media

    Returns:
        Dictionary with influencer tier performance metrics
    """
    influencer_stats = {}

    for influencer_type in marketing_data["Influencer"].unique():
        influencer_rows = marketing_data[marketing_data["Influencer"] == influencer_type]

        influencer_stats[influencer_type] = {
            "avg_sales": float(influencer_rows["Sales"].mean()),
            "avg_spend": float(influencer_rows["Social Media"].mean()),
            "total_sales": float(influencer_rows["Sales"].sum()),
            "count": int(len(influencer_rows)),
        }

    logger.info(f"Analyzed {len(influencer_stats)} influencer tiers")
    return influencer_stats


def generate_recommendations(
    ad_effectiveness: Dict,
    platform_performance: Dict,
    optimal_times: Dict,
    influencer_impact: Dict,
) -> Dict[str, Any]:
    """
    Compile all analysis into actionable recommendations.

    Returns:
        Comprehensive recommendation structure matching frontend expectations
    """
    # Rank platforms by engagement
    platform_ranking = sorted(
        platform_performance.items(),
        key=lambda x: x[1]["total_engagement"],
        reverse=True
    )

    top_platform = platform_ranking[0]

    # Rank influencers by average sales
    influencer_ranking = sorted(
        influencer_impact.items(),
        key=lambda x: x[1]["avg_sales"],
        reverse=True
    )

    # ROI metrics
    social_media_roi = ad_effectiveness.get("Social_Media", {}).get("roi", 0)
    influencer_roi = ad_effectiveness.get("Influencer_Marketing", {}).get("roi", 0)

    recommendations = {
        "primary_platform": {
            "name": top_platform[0],
            "total_engagement": top_platform[1]["total_engagement"],
            "avg_engagement": {
                "likes": top_platform[1]["avg_likes"],
                "comments": top_platform[1]["avg_comments"],
                "shares": top_platform[1]["avg_shares"],
            },
            "justification": (
                f"{top_platform[0]} has the highest total engagement with "
                f"{top_platform[1]['total_engagement']:.0f} total interactions "
                f"across {top_platform[1]['post_count']} posts."
            ),
        },
        "platform_rankings": [
            {
                "rank": idx + 1,
                "platform": name,
                "total_engagement": stats["total_engagement"],
                "avg_likes": stats["avg_likes"],
                "avg_comments": stats["avg_comments"],
                "avg_shares": stats["avg_shares"],
            }
            for idx, (name, stats) in enumerate(platform_ranking)
        ],
        "optimal_posting": optimal_times.get(top_platform[0], {}),
        "content_recommendations": {
            "best_post_types": platform_performance[top_platform[0]]["post_type_performance"]
        },
        "influencer_strategy": {
            "top_performer": {
                "type": influencer_ranking[0][0],
                "avg_sales": influencer_ranking[0][1]["avg_sales"],
                "justification": (
                    f"{influencer_ranking[0][0]} influencers drive the highest "
                    f"average sales of ${influencer_ranking[0][1]['avg_sales']:.2f}"
                ),
            },
            "all_tiers": [
                {
                    "rank": idx + 1,
                    "type": tier_name,
                    "avg_sales": stats["avg_sales"],
                    "avg_spend": stats["avg_spend"],
                }
                for idx, (tier_name, stats) in enumerate(influencer_ranking)
            ],
        },
        "budget_allocation": {
            "social_media_roi": social_media_roi,
            "influencer_marketing_roi": influencer_roi,
            "recommendation": (
                "Focus on Influencer Marketing"
                if influencer_roi > social_media_roi
                else "Balance between Social Media and Influencer Marketing"
            ),
        },
    }

    logger.info("Generated comprehensive recommendations")
    return recommendations


def save_to_rds(conn: pymysql.Connection, recommendations: Dict[str, Any]):
    """
    Optionally persist recommendations to RDS for audit trail.
    Creates a social_media_recommendations table if it doesn't exist.
    """
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS social_media_recommendations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        generated_at DATETIME NOT NULL,
        primary_platform VARCHAR(50),
        best_day VARCHAR(20),
        best_time VARCHAR(20),
        top_influencer VARCHAR(50),
        recommendations_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_generated_at (generated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """

    insert_sql = """
    INSERT INTO social_media_recommendations
    (generated_at, primary_platform, best_day, best_time, top_influencer, recommendations_json)
    VALUES (%s, %s, %s, %s, %s, %s)
    """

    try:
        with conn.cursor() as cursor:
            cursor.execute(create_table_sql)

            cursor.execute(insert_sql, (
                datetime.utcnow(),
                recommendations["primary_platform"]["name"],
                recommendations["optimal_posting"]["best_day"]["day"],
                recommendations["optimal_posting"]["best_hours"][0]["time_range"],
                recommendations["influencer_strategy"]["top_performer"]["type"],
                json.dumps(recommendations, default=_json_default),
            ))

            logger.info(f"Saved recommendations to RDS (id={cursor.lastrowid})")
    except Exception as e:
        logger.warning(f"Failed to save to RDS: {e}")
        # Non-critical failure, continue


# ===== LAMBDA HANDLER =====
def lambda_handler(event, context):
    """
    Main Lambda entry point.

    Expected API Gateway event structure:
    - GET /social-media/recommendations - Process and return recommendations
    - POST /social-media/recommendations - Trigger reprocessing

    Returns:
        API Gateway response with statusCode, headers, and body
    """
    try:
        logger.info(f"Processing social media recommendation request")
        logger.info(f"Event: {json.dumps(event, default=str)}")

        # Load data from S3
        ad_data = _load_csv_from_s3(S3_BUCKET, f"{S3_PREFIX}{ADVERTISING_CSV}")
        social_data = _load_csv_from_s3(S3_BUCKET, f"{S3_PREFIX}{SOCIAL_ENGAGEMENT_CSV}")
        marketing_data = _load_csv_from_s3(S3_BUCKET, f"{S3_PREFIX}{MARKETING_SALES_CSV}")

        # Perform analysis
        logger.info("Analyzing advertising effectiveness...")
        ad_effectiveness = analyze_advertising_effectiveness(ad_data)

        logger.info("Analyzing platform performance...")
        platform_performance = analyze_platform_performance(social_data)

        logger.info("Analyzing optimal posting times...")
        optimal_times = analyze_optimal_posting_times(social_data)

        logger.info("Analyzing influencer impact...")
        influencer_impact = analyze_influencer_impact(marketing_data)

        # Generate recommendations
        logger.info("Generating recommendations...")
        recommendations = generate_recommendations(
            ad_effectiveness,
            platform_performance,
            optimal_times,
            influencer_impact,
        )

        # Save to RDS (optional audit trail)
        try:
            conn = _get_db_connection()
            save_to_rds(conn, recommendations)
            conn.close()
        except Exception as e:
            logger.warning(f"RDS save skipped: {e}")

        # Compile response
        response_body = {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "recommendations": recommendations,
        }

        logger.info("Successfully generated recommendations")

        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps(response_body, default=_json_default),
        }

    except Exception as e:
        logger.error(f"Error processing recommendations: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({
                "error": "Failed to generate recommendations",
                "message": str(e),
            }),
        }
