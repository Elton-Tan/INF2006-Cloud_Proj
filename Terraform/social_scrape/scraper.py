# scraper.py - SIMPLIFIED VERSION
import requests
import json
import os
import boto3
from datetime import datetime


class SocialMediaScraper:

    def __init__(self):
        # Get API key from AWS Secrets Manager instead of dotenv
        self.api_key = self._get_api_key()
        if not self.api_key:
            raise ValueError("API key not found in Secrets Manager")
        
        self.base_url = "https://api.scrapecreators.com/v2"
        self.headers = {"x-api-key": self.api_key}
        self.cache_dir = "/tmp/cached_data"  # Lambda uses /tmp for temp storage
        self.ensure_cache_dir()

    def _get_api_key(self):
        """Get API key from AWS Secrets Manager"""
        try:
            secret_arn = os.environ.get('SCRAPER_SECRET_ARN')
            region = os.environ.get('REGION', 'us-east-1')
            
            print(f"DEBUG: SCRAPER_SECRET_ARN = {secret_arn}")
            print(f"DEBUG: REGION = {region}")
            
            if not secret_arn:
                raise ValueError("SCRAPER_SECRET_ARN environment variable not set")
            
            client = boto3.client('secretsmanager', region_name=region)
            response = client.get_secret_value(SecretId=secret_arn)
            secret_string = response['SecretString']
            
            print(f"DEBUG: Retrieved secret string (first 50 chars): {secret_string[:50]}")
            
            # Parse JSON
            secret = json.loads(secret_string)
            print(f"DEBUG: Secret keys available: {list(secret.keys())}")
            
            # Get the api_key
            api_key =  secret.get('api_key')        
            
            if api_key:
                print(f"DEBUG: API key found, length={len(api_key)}")
                return api_key
            else:
                print(f"ERROR: 'api_key' not found in secret. Full secret: {secret}")
                return None
                
        except Exception as e:
            print(f"ERROR in _get_api_key: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            return None  # Return None instead of raising, let __init__ handle it
    
       
    def ensure_cache_dir(self):
        """Create cache directory if it doesn't exist"""
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)
    
    def scrape_instagram_posts(self, handle, count=20):
        """Scrape Instagram posts for a given handle"""
        print(f"Scraping Instagram @{handle}...")
        
        url = f"{self.base_url}/instagram/user/posts"
        params = {"handle": handle}
        
        try:
            response = requests.get(url, headers=self.headers, params=params)
            response.raise_for_status()
            
            normalized = self.normalize_instagram_data(response.json())
            print(f"✓ Scraped {len(normalized)} posts from @{handle}")
            return normalized
            
        except requests.exceptions.RequestException as e:
            print(f"✗ Error scraping @{handle}: {e}")
            return []
    
    def normalize_instagram_data(self, raw_data):
        """Convert Instagram API response to standard format"""
        normalized = []
        items = raw_data.get('items', [])
        
        for item in items:
            # Extract caption safely
            caption_obj = item.get('caption')
            caption_text = ''
            if caption_obj:
                caption_text = caption_obj.get('text', '') if isinstance(caption_obj, dict) else str(caption_obj)
            
            # Extract user safely
            user_obj = item.get('user', {})
            username = user_obj.get('username', 'unknown') if isinstance(user_obj, dict) else 'unknown'
            
            post = {
                'platform': 'instagram',
                'post_id': str(item.get('pk', f'unknown_{len(normalized)}')),
                'content': caption_text,
                'like_count': int(item.get('like_count') or 0),
                'comment_count': int(item.get('comment_count') or 0),
                'timestamp': item.get('taken_at') or int(datetime.now().timestamp()),
                'author': username,
                'post_url': f"https://instagram.com/p/{item.get('code', '')}"
            }
            normalized.append(post)
        
        return normalized
    
    def collect_sample_data(self, accounts=None, posts_per_account=10):
        """Collect sample data from multiple Instagram accounts"""
        if accounts is None:
            # Default beauty/skincare accounts
            accounts = [
                "sephora",
                "ultabeauty", 
                "glossier",
                "fentybeauty",
                "rarebeauty",
                "cerave",
                "theordinary"
            ]
        
        print(f"Collecting sample data from {len(accounts)} accounts...")
        all_posts = []
        
        for account in accounts:
            posts = self.scrape_instagram_posts(account, count=posts_per_account)
            all_posts.extend(posts)
        
        print(f"\n✓ Total collected: {len(all_posts)} posts")
        return all_posts
    
    def save_to_cache(self, data, filename="instagram_posts.json"):
        """Save data to cache file"""
        filepath = os.path.join(self.cache_dir, filename)
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"✓ Cached {len(data)} posts to {filepath}")
    
    def load_from_cache(self, filename="instagram_posts.json"):
        """Load data from cache file"""
        filepath = os.path.join(self.cache_dir, filename)
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
            print(f"✓ Loaded {len(data)} posts from cache")
            return data
        return None
    
    def get_data(self, use_cache=True, force_refresh=False):
        """Get Instagram data - use cache if available"""
        
        if use_cache and not force_refresh:
            cached = self.load_from_cache()
            if cached:
                return cached
        
        # Collect fresh data
        print("No cache found or refresh requested. Collecting fresh data...")
        posts = self.collect_sample_data()
        
        # Cache for future use
        if posts:
            self.save_to_cache(posts)
        
        return posts