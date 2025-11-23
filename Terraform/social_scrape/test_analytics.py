# test_analytics.py
import sys
sys.path.insert(0, 'Terraform/social_scrape')

from analytics import SocialAnalytics
import time

analytics = SocialAnalytics()

test_posts = [
    {
        'post_id': '1',
        'content': 'Love spending $100 on water 🙄 #sephora',
        'like_count': 500,
        'comment_count': 20,
        'author': 'user1',
        'timestamp': int(time.time())
    },
    {
        'post_id': '2',
        'content': 'This cerave serum is amazing! Holy grail',
        'like_count': 1000,
        'comment_count': 50,
        'author': 'user1',  # Same user for influencer test
        'timestamp': int(time.time() - 3600)
    },
    {
        'post_id': '3',
        'content': 'Expensive but totally worth it 😒 #theordinary',
        'like_count': 200,
        'comment_count': 10,
        'author': 'user2',
        'timestamp': int(time.time() - 7200)
    },
    {
        'post_id': '4',
        'content': '@fenty foundation is perfect for my skin',
        'like_count': 800,
        'comment_count': 30,
        'author': 'user2',  # Same user
        'timestamp': int(time.time() - 10800)
    }
]

print("\n=== SENTIMENT TEST ===")
sentiment = analytics.analyze_sentiment_ml(test_posts)
print(f"Found {len(sentiment)} results")
for s in sentiment:
    print(f"Post {s['post_id']}: {s['classification']} (sarcasm: {s.get('is_sarcastic', False)})")

print("\n=== INFLUENCER TEST ===")
influencers = analytics.identify_influencers(test_posts)
print(f"Found {len(influencers)} influencers")
for inf in influencers:
    print(f"{inf['handle']}: score={inf['influence_score']}, rate={inf.get('engagement_rate', 'N/A')}%")
