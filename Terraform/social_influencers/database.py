# database.py
import pymysql
import json
import os
import boto3
from datetime import datetime

class SocialMediaDB:
    def __init__(self):
        # Get DB credentials from AWS Secrets Manager
        creds = self._get_db_credentials()
        
        self.host = creds.get('host')
        self.user = creds.get('username')
        self.password = creds.get('password')
        self.database = creds.get('database', 'spirulinadb')
        self.port = int(creds.get('port', 3306))
        
        # Test initial connection
        self.connection = self._get_connection()
    def _get_db_credentials(self):
        """Retrieve database credentials from AWS Secrets Manager"""
        secret_arn = os.environ.get('DB_SECRET_ARN')
        region = os.environ.get('REGION', 'us-east-1')
        
        # Create a Secrets Manager client
        client = boto3.client('secretsmanager', region_name=region)
        
        try:
            response = client.get_secret_value(SecretId=secret_arn)
            secret = json.loads(response['SecretString'])
            return secret
        except Exception as e:
            print(f"Error retrieving secret: {e}")
            raise e
    
    def _get_connection(self):
        """Create a new database connection"""
        return pymysql.connect(
            host=self.host,
            user=self.user,
            password=self.password,
            database=self.database,
            port=self.port,
            connect_timeout=5,
            cursorclass=pymysql.cursors.DictCursor
        )
    
    def init_database(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            # ============================================
            # TABLE 1: Hashtag Trends
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS hashtag_trends (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    hashtag VARCHAR(255),
                    post_count INT,
                    total_engagement INT,
                    avg_engagement FLOAT,
                    velocity FLOAT,
                    trending_score FLOAT,
                    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_hashtag (hashtag)
                )
            ''')
            
            # ============================================
            # TABLE 2: Influencers
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS influencers (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    handle VARCHAR(255) UNIQUE,
                    posts INT,
                    total_engagement INT,
                    avg_engagement FLOAT,
                    engagement_rate FLOAT,
                    influence_score FLOAT,
                    products_mentioned TEXT,
                    brands_mentioned TEXT,
                    top_hashtags TEXT,
                    platforms TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_handle (handle),
                    INDEX idx_influence_score (influence_score)
                )
            ''')
            
            # ============================================
            # TABLE 3: Brand Mentions
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS brand_mentions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    brand VARCHAR(255),
                    mention_count INT,
                    total_engagement INT,
                    positive_pct FLOAT,
                    negative_pct FLOAT,
                    neutral_pct FLOAT,
                    platforms TEXT,
                    tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_brand (brand)
                )
            ''')
            
            # ============================================
            # TABLE 4: Social Posts (Main)
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS social_posts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    platform VARCHAR(50),
                    post_id VARCHAR(255) UNIQUE,
                    content TEXT,
                    like_count INT DEFAULT 0,
                    comment_count INT DEFAULT 0,
                    engagement_score INT DEFAULT 0,
                    author VARCHAR(255),
                    timestamp BIGINT,
                    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_platform (platform),
                    INDEX idx_post_id (post_id),
                    INDEX idx_author (author)
                )
            ''')
            
            # ============================================
            # TABLE 5: Sentiment Analysis
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sentiment_analysis (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    post_id VARCHAR(255),
                    sentiment_label VARCHAR(50),
                    sentiment_score FLOAT,
                    classification VARCHAR(50),
                    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_post_id (post_id),
                    INDEX idx_classification (classification),
                    FOREIGN KEY (post_id) REFERENCES social_posts(post_id) ON DELETE CASCADE
                )
            ''')
            
            # ============================================
            # TABLE 6: Product Mentions
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS product_mentions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    post_id VARCHAR(255),
                    products TEXT,
                    brands TEXT,
                    engagement INT DEFAULT 0,
                    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_post_id (post_id),
                    FOREIGN KEY (post_id) REFERENCES social_posts(post_id) ON DELETE CASCADE
                )
            ''')
            
            # ============================================
            # TABLE 7: Viral Content
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS viral_content (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    post_id VARCHAR(255),
                    viral_score VARCHAR(50),
                    engagement INT DEFAULT 0,
                    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_post_id (post_id),
                    FOREIGN KEY (post_id) REFERENCES social_posts(post_id) ON DELETE CASCADE
                )
            ''')
            
            # ============================================
            # TABLE 8: Engagement Predictions
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS engagement_predictions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    post_id VARCHAR(255),
                    predicted_engagement INT,
                    actual_engagement INT,
                    prediction_accuracy FLOAT,
                    predicted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_post_id (post_id),
                    FOREIGN KEY (post_id) REFERENCES social_posts(post_id) ON DELETE CASCADE
                )
            ''')
            
            # ============================================
            # TABLE 9: Trending Topics
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS trending_topics (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    topic_keywords TEXT,
                    topic_weight FLOAT,
                    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # ============================================
            # TABLE 10: Watchlist
            # ============================================
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS watchlist (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT,
                    social_url TEXT,
                    platform VARCHAR(50),
                    product_name VARCHAR(255),
                    initial_sentiment FLOAT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_id (user_id)
                )
            ''')
            
            conn.commit()
        finally:
            conn.close()
    
    # ============================================
    # WRITE METHODS
    # ============================================
    
    def save_posts(self, posts):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for post in posts:
                cursor.execute('''
                    INSERT INTO social_posts 
                    (platform, post_id, content, like_count, comment_count, 
                     engagement_score, author, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        like_count = VALUES(like_count),
                        comment_count = VALUES(comment_count),
                        engagement_score = VALUES(engagement_score)
                ''', (
                    post.get('platform'), 
                    post.get('post_id'), 
                    post.get('content'),
                    post.get('like_count', 0), 
                    post.get('comment_count', 0),
                    post.get('like_count', 0) + post.get('comment_count', 0),
                    post.get('author'), 
                    post.get('timestamp')
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_sentiment_results(self, sentiment_results):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for result in sentiment_results:
                cursor.execute('''
                    INSERT INTO sentiment_analysis 
                    (post_id, sentiment_label, sentiment_score, classification)
                    VALUES (%s, %s, %s, %s)
                ''', (
                    result['post_id'], 
                    result.get('label'), 
                    result.get('score'), 
                    result.get('classification')
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_product_mentions(self, mentions):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for mention in mentions:
                cursor.execute('''
                    INSERT INTO product_mentions 
                    (post_id, products, brands, engagement)
                    VALUES (%s, %s, %s, %s)
                ''', (
                    mention['post_id'], 
                    json.dumps(mention.get('products', [])),
                    json.dumps(mention.get('brands', [])),
                    mention.get('engagement', 0)
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_viral_content(self, viral_posts):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for post in viral_posts:
                cursor.execute('''
                    INSERT INTO viral_content 
                    (post_id, viral_score, engagement)
                    VALUES (%s, %s, %s)
                ''', (
                    post['post_id'], 
                    post['viral_score'], 
                    post['engagement']
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_engagement_predictions(self, predictions):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for pred in predictions:
                actual = pred.get('actual_engagement', 0)
                predicted = pred.get('predicted_engagement', 0)
                accuracy = 1 - abs(actual - predicted) / max(actual, 1)
                
                cursor.execute('''
                    INSERT INTO engagement_predictions 
                    (post_id, predicted_engagement, actual_engagement, prediction_accuracy)
                    VALUES (%s, %s, %s, %s)
                ''', (
                    pred['post_id'], 
                    predicted, 
                    actual, 
                    accuracy
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_hashtag_trends(self, hashtags):
        """Save trending hashtags to database"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for tag in hashtags:
                cursor.execute('''
                    INSERT INTO hashtag_trends 
                    (hashtag, post_count, total_engagement, avg_engagement, velocity, trending_score)
                    VALUES (%s, %s, %s, %s, %s, %s)
                ''', (
                    tag['hashtag'],
                    tag['post_count'],
                    tag['total_engagement'],
                    tag['avg_engagement'],
                    tag.get('velocity', 1.0),  # ✅ NEW
                    tag.get('trending_score', 0.0)  # ✅ NEW
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_influencers(self, influencers):
        """Save influencer data to database"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for inf in influencers:
                cursor.execute('''
                    INSERT INTO influencers 
                    (handle, posts, total_engagement, avg_engagement, engagement_rate, influence_score,
                     products_mentioned, brands_mentioned, top_hashtags, platforms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        posts = VALUES(posts),
                        total_engagement = VALUES(total_engagement),
                        avg_engagement = VALUES(avg_engagement),
                        engagement_rate = VALUES(engagement_rate),
                        influence_score = VALUES(influence_score),
                        products_mentioned = VALUES(products_mentioned),
                        brands_mentioned = VALUES(brands_mentioned),
                        top_hashtags = VALUES(top_hashtags),
                        platforms = VALUES(platforms)
                ''', (
                    inf['handle'],
                    inf['posts'],
                    inf['total_engagement'],
                    inf['avg_engagement'],
                    inf.get('engagement_rate', 0.0),  
                    inf['influence_score'],
                    json.dumps(inf['products_mentioned']),
                    json.dumps(inf['brands_mentioned']),
                    json.dumps(inf['top_hashtags']),
                    json.dumps(inf['platforms'])
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def save_brand_mentions(self, brands):
        """Save brand mention statistics to database"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            for brand in brands:
                cursor.execute('''
                    INSERT INTO brand_mentions 
                    (brand, mention_count, total_engagement, 
                     positive_pct, negative_pct, neutral_pct, platforms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (
                    brand['brand'],
                    brand['mention_count'],
                    brand['total_engagement'],
                    brand['sentiment']['positive'],
                    brand['sentiment']['negative'],
                    brand['sentiment']['neutral'],
                    json.dumps(brand['platforms'])
                ))
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    # ============================================
    # READ METHODS
    # ============================================
    
    def get_all_posts(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT * FROM social_posts")
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_posts_by_platform(self, platform):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT * FROM social_posts WHERE platform = %s", (platform,))
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_sentiment_stats(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT classification, COUNT(*) as count 
                FROM sentiment_analysis 
                GROUP BY classification
            ''')
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_top_products(self, limit=10):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT products, SUM(engagement) as total_engagement 
                FROM product_mentions 
                GROUP BY products 
                ORDER BY total_engagement DESC 
                LIMIT %s
            ''', (limit,))
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_brand_mentions(self, limit=10):
        """Get brand mention statistics"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT brand, mention_count, total_engagement, 
                       positive_pct, negative_pct, neutral_pct, platforms
                FROM brand_mentions 
                ORDER BY mention_count DESC 
                LIMIT %s
            ''', (limit,))
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_top_influencers(self, limit=10):
        """Get top influencers by influence score"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT handle, posts, avg_engagement, engagement_rate, influence_score,
                       products_mentioned, brands_mentioned, top_hashtags, platforms
                FROM influencers 
                ORDER BY influence_score DESC 
                LIMIT %s
            ''', (limit,))
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_trending_hashtags(self, limit=20):
        """Get trending hashtags by engagement"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT hashtag, post_count, total_engagement, avg_engagement, velocity, trending_score
                FROM hashtag_trends 
                ORDER BY trending_score DESC 
                LIMIT %s
            ''', (limit,))
            results = cursor.fetchall()
            return results
        finally:
            conn.close()
    
    def get_sentiment_by_platform(self):
        """Get sentiment breakdown by platform for API"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT 
                    sp.platform,
                    sa.classification,
                    COUNT(*) as count
                FROM sentiment_analysis sa
                JOIN social_posts sp ON sa.post_id = sp.post_id
                GROUP BY sp.platform, sa.classification
            ''')
            
            results = cursor.fetchall()
            
            # Format results
            platform_sentiment = {}
            for row in results:
                platform = row['platform']
                sentiment = row['classification']
                count = row['count']
                
                if platform not in platform_sentiment:
                    platform_sentiment[platform] = {
                        'positive': 0, 'negative': 0, 'neutral': 0, 'total': 0
                    }
                platform_sentiment[platform][sentiment] = count
                platform_sentiment[platform]['total'] += count
            
            # Calculate percentages
            for platform, stats in platform_sentiment.items():
                total = stats['total']
                if total > 0:
                    stats['positive_pct'] = round(stats['positive'] / total * 100, 1)
                    stats['negative_pct'] = round(stats['negative'] / total * 100, 1)
                    stats['neutral_pct'] = round(stats['neutral'] / total * 100, 1)
            
            return platform_sentiment
        finally:
            conn.close()