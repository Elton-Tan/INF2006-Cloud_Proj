# lambda_handlers/social_brands/handler.py
import json
import sys
import os

sys.path.insert(0, '/opt/python')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from database import SocialMediaDB

def safe_json_loads(json_str, default=None):
    """Safely parse JSON, return default if None/empty/invalid"""
    if not json_str:
        return default if default is not None else []
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else []

def lambda_handler(event, context):
    try:
        query_params = event.get('queryStringParameters') or {}
        limit = int(query_params.get('limit', 10))
        
        db = SocialMediaDB()
        brands = db.get_brand_mentions(limit)
        
        result = []
        for row in brands:  # ✅ row is a dict
            result.append({
                'brand': row['brand'],
                'mention_count': int(row['mention_count']) if row['mention_count'] else 0,
                'total_engagement': int(row['total_engagement']) if row['total_engagement'] else 0,
                'sentiment': {
                    'positive': float(row['positive_pct']) if row['positive_pct'] else 0.0,
                    'negative': float(row['negative_pct']) if row['negative_pct'] else 0.0,
                    'neutral': float(row['neutral_pct']) if row['neutral_pct'] else 0.0
                },
                'platforms': safe_json_loads(row['platforms'], [])
            })
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'brands': result})
        }
    except Exception as e:
        print(f"Error in brands handler: {e}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

# For local testing
if __name__ == "__main__":
    # Mock API Gateway event
    test_event = {
        'queryStringParameters': {'limit': '5'}
    }
    
    result = lambda_handler(test_event, {})
    print(f"Status: {result['statusCode']}")
    print(json.dumps(json.loads(result['body']), indent=2))