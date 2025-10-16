# lambda_handlers/social_scrape/handler.py
import json
import sys
import os

# For Lambda layers
sys.path.insert(0, '/opt/python')

# For local testing, add parent directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from scraper import SocialMediaScraper
from database import SocialMediaDB
from analytics import SocialAnalytics

def lambda_handler(event, context):
    """
    Scheduled Lambda to scrape Instagram posts and run analytics
    """
    print("Starting social listening scrape cycle...")
    
    try:
        # Initialize
        scraper = SocialMediaScraper()
        db = SocialMediaDB()
        analytics = SocialAnalytics()
        
        # Get fresh data (or use cache for testing)
        posts = scraper.get_data(use_cache=False, force_refresh=True)
        
        if not posts:
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'No posts collected', 'posts_processed': 0})
            }
        
        # Save posts
        db.save_posts(posts)
        
        # Run analytics
        sentiment_results = analytics.analyze_sentiment_ml(posts)
        entity_mentions = analytics.extract_entities_ml(posts)
        hashtags = analytics.extract_hashtags(posts)
        influencers = analytics.identify_influencers(posts)
        brand_mentions = analytics.track_brand_mentions(posts)
        
        # Save analytics results
        db.save_sentiment_results(sentiment_results)
        db.save_product_mentions(entity_mentions)
        db.save_hashtag_trends(hashtags)
        db.save_influencers(influencers)
        db.save_brand_mentions(brand_mentions)
        
        # Train models if we have enough data
        if len(posts) >= 10:
            analytics.train_engagement_predictor(posts)
            analytics.train_viral_detector(posts)
        
        print(f"Successfully processed {len(posts)} posts")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Scrape completed successfully',
                'posts_processed': len(posts),
                'sentiment_analyzed': len(sentiment_results),
                'entities_extracted': len(entity_mentions),
                'hashtags_found': len(hashtags),
                'influencers_identified': len(influencers),
                'brands_tracked': len(brand_mentions)
            })
        }
        
    except Exception as e:
        print(f"Error in scrape handler: {e}")
        import traceback
        traceback.print_exc()
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


# For local testing
if __name__ == "__main__":
    result = lambda_handler({}, {})
    print(json.dumps(json.loads(result['body']), indent=2))