# lambda_handlers/social_influencers/handler.py
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
        influencers = db.get_top_influencers(limit)
        
        result = []
        for row in influencers:  # ✅ row is a dict
            result.append({
                'handle': row['handle'],
                'posts': int(row['posts']) if row['posts'] else 0,
                'avg_engagement': float(row['avg_engagement']) if row['avg_engagement'] else 0.0,
                'engagement_rate': float(row.get('engagement_rate', 0.0)), 
                'influence_score': float(row['influence_score']) if row['influence_score'] else 0.0,
                'products_mentioned': safe_json_loads(row['products_mentioned'], []),
                'brands_mentioned': safe_json_loads(row['brands_mentioned'], []),
                'top_hashtags': safe_json_loads(row['top_hashtags'], []),
                'platforms': safe_json_loads(row['platforms'], [])
            })
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'influencers': result})
        }
    except Exception as e:
        print(f"Error in influencers handler: {e}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

# For local testing
if __name__ == "__main__":
    test_event = {
        'queryStringParameters': {'limit': '5'}
    }
    
    result = lambda_handler(test_event, {})
    print(f"Status: {result['statusCode']}")
    print(json.dumps(json.loads(result['body']), indent=2))