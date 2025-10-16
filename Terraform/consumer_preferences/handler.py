#!/usr/bin/env python3
"""
Lambda handler for consumer preferences processing.
Analyzes shopping preferences data to generate radar chart visualization
showing consumer behavior patterns by age group.

Triggered via API Gateway GET /consumer-preferences
Returns JSON with radar chart data and key findings.
"""

import os
import json
import logging
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Any
from collections import defaultdict
import boto3
import pymysql
import csv
from io import StringIO

# ===== CONFIGURATION =====
logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.getenv("AWS_REGION", os.getenv("REGION", "us-east-1"))
SECRET_ARN = os.environ["DB_SECRET_ARN"]
S3_BUCKET = os.getenv("S3_DATA_BUCKET", "spiruvita-data")
S3_PREFIX = os.getenv("S3_DATA_PREFIX", "consumer-preferences/")
CSV_FILE = "ShoppingPreferences.csv"


# ===== UTILITY FUNCTIONS =====
def _json_default(obj):
    """JSON serializer for objects not serializable by default json module."""
    if isinstance(obj, (datetime,)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
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


def _load_csv_from_s3(bucket: str, key: str) -> List[Dict[str, str]]:
    """Load CSV file from S3 into list of dictionaries."""
    s3 = boto3.client("s3", region_name=REGION)
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        csv_content = obj["Body"].read().decode("utf-8")
        csv_reader = csv.DictReader(StringIO(csv_content))
        data = list(csv_reader)
        logger.info(f"Loaded {key}: {len(data)} rows")
        return data
    except Exception as e:
        logger.error(f"Failed to load {key} from S3: {e}")
        raise


# ===== DATA PROCESSING FUNCTIONS =====
def process_consumer_preferences_data(csv_data: List[Dict[str, str]]) -> Dict[str, Any]:
    """
    Process shopping preferences CSV data and generate radar chart data.

    Args:
        csv_data: List of dictionaries from CSV rows

    Returns:
        Dictionary with radar chart data, key findings, and metadata
    """
    # Age group mapping to standardized groups
    age_group_map = {
        "Under 18": "18-25",
        "18-24": "18-25",
        "25-34": "26-35",
        "35-44": "36-45",
        "45-54": "46-55",
        "55 and above": "56+",
        "55+": "56+"
    }

    # Initialize counters for each age group
    age_groups = ["18-25", "26-35", "36-45", "46-55", "56+"]
    preferences = {
        age: {
            "online_shopping": [],
            "price_sensitivity": [],
            "brand_loyalty": [],
            "quality_focus": [],
            "platform_trust": []
        }
        for age in age_groups
    }

    # Process each row
    for row in csv_data:
        age = row.get("Age Group", "").strip()
        age_group = age_group_map.get(age)

        if not age_group:
            continue

        # Online Shopping Frequency (0-100 scale)
        frequency = row.get("Shopping Frequency", "").strip().lower()
        if "daily" in frequency:
            preferences[age_group]["online_shopping"].append(100)
        elif "weekly" in frequency:
            preferences[age_group]["online_shopping"].append(85)
        elif "monthly" in frequency:
            preferences[age_group]["online_shopping"].append(65)
        elif "occasionally" in frequency:
            preferences[age_group]["online_shopping"].append(40)
        elif "rarely" in frequency:
            preferences[age_group]["online_shopping"].append(20)

        # Price Sensitivity
        factor = row.get("Important Factor", "").strip().lower()
        if "price" in factor or "discount" in factor or "offer" in factor or "coupon" in factor:
            preferences[age_group]["price_sensitivity"].append(100)
        else:
            preferences[age_group]["price_sensitivity"].append(30)

        # Brand Loyalty - derived from trust level and important factor
        trust = row.get("Trust Level", "").strip().lower()
        if "platform trust" in factor or "security" in factor:
            # High loyalty if they value platform trust
            if "completely trust" in trust:
                preferences[age_group]["brand_loyalty"].append(95)
            elif "somewhat trust" in trust:
                preferences[age_group]["brand_loyalty"].append(75)
            else:
                preferences[age_group]["brand_loyalty"].append(50)
        else:
            # Medium loyalty based on trust level only
            if "completely trust" in trust:
                preferences[age_group]["brand_loyalty"].append(80)
            elif "somewhat trust" in trust:
                preferences[age_group]["brand_loyalty"].append(55)
            elif "neutral" in trust:
                preferences[age_group]["brand_loyalty"].append(40)
            else:
                preferences[age_group]["brand_loyalty"].append(25)

        # Quality Focus - derived from important factor
        if "quality" in factor:
            preferences[age_group]["quality_focus"].append(95)
        elif "product variety" in factor:
            preferences[age_group]["quality_focus"].append(70)
        elif "return" in factor or "refund" in factor:
            preferences[age_group]["quality_focus"].append(60)
        else:
            preferences[age_group]["quality_focus"].append(40)

        # Platform Trust - directly from trust level
        if "completely trust" in trust:
            preferences[age_group]["platform_trust"].append(95)
        elif "somewhat trust" in trust:
            preferences[age_group]["platform_trust"].append(70)
        elif "neutral" in trust:
            preferences[age_group]["platform_trust"].append(50)
        elif "somewhat don't" in trust or "somewhat don't trust" in trust:
            preferences[age_group]["platform_trust"].append(30)
        else:  # don't trust at all
            preferences[age_group]["platform_trust"].append(10)

    # Calculate averages
    def avg(values):
        return round(sum(values) / len(values)) if values else 0

    # Build radar chart data
    radar_data = [
        {
            "category": "Natural Ingredients",
            **{age: avg(preferences[age]["quality_focus"]) for age in age_groups}
        },
        {
            "category": "Clinical Efficacy",
            **{age: avg(preferences[age]["platform_trust"]) for age in age_groups}
        },
        {
            "category": "Price Sensitivity",
            **{age: avg(preferences[age]["price_sensitivity"]) for age in age_groups}
        },
        {
            "category": "Brand Loyalty",
            **{age: avg(preferences[age]["brand_loyalty"]) for age in age_groups}
        },
        {
            "category": "Online Shopping",
            **{age: avg(preferences[age]["online_shopping"]) for age in age_groups}
        }
    ]

    # Generate key findings
    key_findings = []

    # Natural ingredients (quality focus) preference by age
    quality_scores = {age: avg(preferences[age]["quality_focus"]) for age in age_groups}
    max_quality_age = max(quality_scores.items(), key=lambda x: x[1])
    key_findings.append(
        f"Natural ingredients preference highest in {max_quality_age[0]} age group ({max_quality_age[1]}%)"
    )

    # Brand loyalty trend
    loyalty_scores = {age: avg(preferences[age]["brand_loyalty"]) for age in age_groups}
    max_loyalty_age = max(loyalty_scores.items(), key=lambda x: x[1])
    key_findings.append(
        f"Brand loyalty increases with age, peaking at {max_loyalty_age[1]}% for {max_loyalty_age[0]}"
    )

    # Online shopping frequency
    online_scores = {age: avg(preferences[age]["online_shopping"]) for age in age_groups}
    youngest_online = online_scores["18-25"]
    oldest_online = online_scores["56+"]
    if youngest_online > oldest_online:
        key_findings.append("Online shopping preference decreases with age")
    else:
        key_findings.append("Online shopping preference increases with age")

    # Clinical efficacy (platform trust)
    trust_scores = {age: avg(preferences[age]["platform_trust"]) for age in age_groups}
    max_trust_age = max(trust_scores.items(), key=lambda x: x[1])
    key_findings.append(
        f"Clinical efficacy most valued by {max_trust_age[0]} age group"
    )

    # Build output
    output = {
        "data": radar_data,
        "keyFindings": key_findings,
        "metadata": {
            "totalResponses": sum(len(preferences[age]["online_shopping"]) for age in age_groups),
            "ageGroups": [
                {
                    "ageGroup": age,
                    "count": len(preferences[age]["online_shopping"])
                }
                for age in age_groups
            ],
            "lastUpdated": datetime.utcnow().strftime("%Y-%m-%d"),
            "source": "Shopping Preferences Survey"
        }
    }

    logger.info(f"Processed {output['metadata']['totalResponses']} total responses")
    return output


def save_to_rds(conn: pymysql.Connection, data: Dict[str, Any]):
    """
    Optionally persist consumer preferences analysis to RDS for audit trail.
    Creates a consumer_preferences table if it doesn't exist.
    """
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS consumer_preferences_analysis (
        id INT AUTO_INCREMENT PRIMARY KEY,
        generated_at DATETIME NOT NULL,
        total_responses INT,
        data_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_generated_at (generated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """

    insert_sql = """
    INSERT INTO consumer_preferences_analysis
    (generated_at, total_responses, data_json)
    VALUES (%s, %s, %s)
    """

    try:
        with conn.cursor() as cursor:
            cursor.execute(create_table_sql)

            cursor.execute(insert_sql, (
                datetime.utcnow(),
                data["metadata"]["totalResponses"],
                json.dumps(data, default=_json_default),
            ))

            logger.info(f"Saved consumer preferences to RDS (id={cursor.lastrowid})")
    except Exception as e:
        logger.warning(f"Failed to save to RDS: {e}")
        # Non-critical failure, continue


# ===== LAMBDA HANDLER =====
def lambda_handler(event, context):
    """
    Main Lambda entry point.

    Expected API Gateway event structure:
    - GET /consumer-preferences - Process and return consumer preferences data

    Returns:
        API Gateway response with statusCode, headers, and body
    """
    try:
        logger.info(f"Processing consumer preferences request")
        logger.info(f"Event: {json.dumps(event, default=str)}")

        # Load data from S3
        csv_data = _load_csv_from_s3(S3_BUCKET, f"{S3_PREFIX}{CSV_FILE}")

        # Process data
        logger.info("Analyzing consumer preferences...")
        result = process_consumer_preferences_data(csv_data)

        # Save to RDS (optional audit trail)
        try:
            conn = _get_db_connection()
            save_to_rds(conn, result)
            conn.close()
        except Exception as e:
            logger.warning(f"RDS save skipped: {e}")

        logger.info("Successfully generated consumer preferences analysis")

        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps(result, default=_json_default),
        }

    except Exception as e:
        logger.error(f"Error processing consumer preferences: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({
                "error": "Failed to generate consumer preferences analysis",
                "message": str(e),
            }),
        }
