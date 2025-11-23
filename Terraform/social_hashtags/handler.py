# lambda_handlers/social_hashtags/handler.py
import json
import sys
import os

sys.path.insert(0, '/opt/python')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from database import SocialMediaDB

def lambda_handler(event, context):
    try:
        query_params = event.get('queryStringParameters') or {}
        limit = int(query_params.get('limit', 20))
        
        db = SocialMediaDB()
        hashtags = db.get_trending_hashtags(limit)
        
        result = []
        for row in hashtags:  
            result.append({
                'hashtag': row['hashtag'],
                'post_count': int(row['post_count']) if row['post_count'] else 0,
                'total_engagement': int(row['total_engagement']) if row['total_engagement'] else 0,
                'avg_engagement': float(row['avg_engagement']) if row['avg_engagement'] else 0.0,
                'velocity': float(row.get('velocity', 1.0)),  
                'trending_score': float(row.get('trending_score', 0.0))  
            })
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'hashtags': result})
        }
    except Exception as e:
        print(f"Error in hashtags handler: {e}")
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
        'queryStringParameters': {'limit': '20'}
    }
    
    result = lambda_handler(test_event, {})
    print(f"Status: {result['statusCode']}")
    print(json.dumps(json.loads(result['body']), indent=2))