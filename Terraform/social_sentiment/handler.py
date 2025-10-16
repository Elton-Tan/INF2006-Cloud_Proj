# lambda_handlers/social_sentiment/handler.py
import json
import sys
import os

sys.path.insert(0, '/opt/python')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from database import SocialMediaDB

def lambda_handler(event, context):
    """
    GET /social/sentiment-by-platform
    Returns sentiment distribution by platform
    """
    try:
        db = SocialMediaDB()
        platform_sentiment = db.get_sentiment_by_platform()
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'platforms': platform_sentiment})
        }
        
    except Exception as e:
        print(f"Error in sentiment handler: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }


# For local testing
if __name__ == "__main__":
    result = lambda_handler({}, {})
    print(f"Status: {result['statusCode']}")
    print(json.dumps(json.loads(result['body']), indent=2))