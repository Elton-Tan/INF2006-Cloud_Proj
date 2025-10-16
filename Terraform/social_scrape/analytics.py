# analytics.py - SIMPLIFIED (No Transformers)
# import spacy  # 
# from textblob import TextBlob
from sklearn.ensemble import RandomForestRegressor, IsolationForest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import LatentDirichletAllocation
import numpy as np
from nltk.sentiment import SentimentIntensityAnalyzer
from collections import Counter
import pickle
import re 
from collections import defaultdict
import os

class SocialAnalytics:
    def __init__(self, model_dir='/tmp/models'):
        self.model_dir = model_dir
        os.makedirs(model_dir, exist_ok=True)

        import nltk
        nltk.data.path.append('/tmp/nltk_data')
    


        try:
            nltk.data.find('sentiment/vader_lexicon.zip')
        except LookupError:
            nltk.download('vader_lexicon', download_dir='/tmp/nltk_data')
    
        self.sentiment_analyzer = SentimentIntensityAnalyzer()

        self.beauty_brands = ['sephora', 'ulta', 'glossier', 'fenty', 'rare beauty', 
                             'cerave', 'neutrogena', 'the ordinary', 'drunk elephant']
        self.beauty_products = ['serum', 'moisturizer', 'cleanser', 'foundation', 
                               'lipstick', 'mascara', 'toner', 'sunscreen', 'concealer']
        
        # Load pre-trained models
        print("Loading ML models...")
        # ✅ REMOVED: self.sentiment_model = pipeline(...)
        # ✅ USE TextBlob instead (simpler, smaller)
        # self.nlp = spacy.load("en_core_web_sm")
        
        # Custom models
        self.engagement_predictor = None
        self.viral_detector = None
        
        self.engagement_predictor = self._load_model('engagement_predictor.pkl')
        self.viral_detector = self._load_model('viral_detector.pkl')

        print("ML models loaded successfully")
    
    def _save_model(self, model, filename):
        filepath = os.path.join(self.model_dir, filename)
        with open(filepath, 'wb') as f:
            pickle.dump(model, f)
        print(f"  ✓ Model saved: {filename}")

    def _load_model(self, filename):
        filepath = os.path.join(self.model_dir, filename)
        if os.path.exists(filepath):
            with open(filepath, 'rb') as f:
                return pickle.load(f)
        return None

    # ===== SENTIMENT ANALYSIS (Using TextBlob - Simpler!) =====
    def analyze_sentiment_ml(self, posts):
        """Sentiment analysis using TextBlob"""
        results = []
        
        for post in posts:
            content = post.get('content', '')
            if content and len(content) > 10:
                try:
                    # Use VADER instead of TextBlob
                    scores = self.sentiment_analyzer.polarity_scores(content)
                    compound = scores['compound']  # -1 to 1
                    
                    # Map compound score to classification
                    if compound >= 0.05:
                        classification = 'positive'
                    elif compound <= -0.05:
                        classification = 'negative'
                    else:
                        classification = 'neutral'
                    
                    result = {
                        'post_id': post.get('post_id'),
                        'label': classification,
                        'score': abs(compound),
                        'classification': classification,
                        'engagement': post.get('like_count', 0) + post.get('comment_count', 0)
                    }
                    results.append(result)
                except Exception as e:
                    print(f"Error analyzing sentiment for post {post.get('post_id')}: {e}")
    
        return results
              

    # ===== NAMED ENTITY RECOGNITION =====
    def extract_entities_ml(self, posts):
        """Extract products, brands using keyword matching"""
        entity_mentions = []
        
        for post in posts:
            content = post.get('content', '').lower()
            if not content:
                continue
                
            products = []
            brands = []
            
            for brand in self.beauty_brands:
                if brand in content:
                    brands.append(brand.title())
            
            for product in self.beauty_products:
                if product in content:
                    products.append(product.title())
            
            products = list(set(products))
            brands = list(set(brands))
            
            if products or brands:
                entity_mentions.append({
                    'post_id': post.get('post_id'),
                    'products': products,
                    'brands': brands,
                    'engagement': post.get('like_count', 0) + post.get('comment_count', 0)
                })
        
        return entity_mentions
    
    # ===== TOPIC MODELING =====
    def discover_topics_lda(self, posts, n_topics=5):
        """Discover trending topics using LDA"""
        contents = [post.get('content', '') for post in posts if post.get('content')]
        
        if len(contents) < 5:
            return {"error": "Not enough posts for topic modeling"}
        
        vectorizer = TfidfVectorizer(max_features=100, stop_words='english', 
                                     min_df=2, max_df=0.8)
        doc_term_matrix = vectorizer.fit_transform(contents)
        
        lda = LatentDirichletAllocation(n_components=n_topics, random_state=42)
        lda.fit(doc_term_matrix)
        
        feature_names = vectorizer.get_feature_names_out()
        topics = []
        
        for topic_idx, topic in enumerate(lda.components_):
            top_words_idx = topic.argsort()[-10:][::-1]
            top_words = [feature_names[i] for i in top_words_idx]
            topics.append({
                'topic_id': topic_idx,
                'keywords': top_words[:5],
                'weight': float(topic.sum())
            })
        
        return topics
    
    # ===== ENGAGEMENT PREDICTION =====
    def train_engagement_predictor(self, posts):
        """Train custom model to predict engagement"""
        features = []
        targets = []
        
        for post in posts:
            content = post.get('content', '')
            if content:
                feature_vector = self.extract_engagement_features(post)
                engagement = post.get('like_count', 0) + post.get('comment_count', 0)
                
                features.append(feature_vector)
                targets.append(engagement)
        
        if len(features) < 10:
            print("Not enough data to train engagement predictor")
            return
        
        X = np.array(features)
        y = np.array(targets)
        
        self.engagement_predictor = RandomForestRegressor(n_estimators=50, random_state=42)
        self.engagement_predictor.fit(X, y)
        self._save_model(self.engagement_predictor, 'engagement_predictor.pkl')
        print(f"Engagement predictor trained on {len(features)} posts")

    def extract_engagement_features(self, post):
        """Extract features for engagement prediction"""
        content = post.get('content', '')
        
        features = [
            len(content),
            content.count('#'),
            content.count('@'),
            1 if any(brand in content.lower() for brand in self.beauty_brands) else 0,
            1 if any(prod in content.lower() for prod in self.beauty_products) else 0,
            len(content.split()),
        ]
        
        return features
    
    def predict_engagement(self, post):
        """Predict engagement for a new post"""
        if self.engagement_predictor is None:
            return None
        
        features = self.extract_engagement_features(post)
        prediction = self.engagement_predictor.predict([features])[0]
        
        return {
            'post_id': post.get('post_id'),
            'predicted_engagement': int(prediction),
            'actual_engagement': post.get('like_count', 0) + post.get('comment_count', 0)
        }
    
    # ===== VIRAL CONTENT DETECTION =====
    def train_viral_detector(self, posts):
        """Train anomaly detector to identify viral content"""
        features = []
        
        for post in posts:
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            content_length = len(post.get('content', ''))
            
            if content_length > 0:
                features.append([
                    engagement,
                    content_length,
                    engagement / max(content_length, 1)
                ])
        
        if len(features) < 10:
            print("Not enough data to train viral detector")
            return
        
        X = np.array(features)
        
        self.viral_detector = IsolationForest(contamination=0.1, random_state=42)
        self.viral_detector.fit(X)
        self._save_model(self.viral_detector, 'viral_detector.pkl')
        print(f"Viral detector trained on {len(features)} posts")
    
    def detect_viral_posts(self, posts):
        """Identify potentially viral content"""
        if self.viral_detector is None:
            return []
        
        viral_posts = []
        
        for post in posts:
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            content_length = len(post.get('content', ''))
            
            if content_length > 0:
                features = [[
                    engagement,
                    content_length,
                    engagement / max(content_length, 1)
                ]]
                
                prediction = self.viral_detector.predict(features)[0]
                
                if prediction == -1:
                    viral_posts.append({
                        'post_id': post.get('post_id'),
                        'engagement': engagement,
                        'content': post.get('content', '')[:100],
                        'viral_score': 'high'
                    })
        
        return viral_posts
    
    # ===== CROSS-PLATFORM ANALYTICS =====
    def cross_platform_sentiment(self, posts):
        """Compare sentiment across platforms"""
        platform_sentiment = {}
        
        sentiment_results = self.analyze_sentiment_ml(posts)
        
        for i, post in enumerate(posts):
            if i < len(sentiment_results):
                platform = post.get('platform', 'unknown')
                sentiment = sentiment_results[i]['classification']
                
                if platform not in platform_sentiment:
                    platform_sentiment[platform] = {
                        'positive': 0, 'negative': 0, 'neutral': 0, 'total': 0
                    }
                
                platform_sentiment[platform][sentiment] += 1
                platform_sentiment[platform]['total'] += 1
        
        return platform_sentiment
    
    def trending_products_ml(self, posts):
        """Find trending products using NER and engagement"""
        entity_mentions = self.extract_entities_ml(posts)
        
        product_stats = {}
        
        for mention in entity_mentions:
            for product in mention['products']:
                if product not in product_stats:
                    product_stats[product] = {
                        'mentions': 0,
                        'total_engagement': 0
                    }
                product_stats[product]['mentions'] += 1
                product_stats[product]['total_engagement'] += mention['engagement']
        
        trending = sorted(product_stats.items(), 
                         key=lambda x: x[1]['total_engagement'], 
                         reverse=True)
        
        return trending[:10]

    # ===== HASHTAG EXTRACTION =====
    def extract_hashtags(self, posts):
        """Extract and rank trending hashtags with engagement"""
        hashtag_stats = defaultdict(lambda: {
            'count': 0,
            'total_engagement': 0,
            'posts': []
        })
        
        for post in posts:
            content = post.get('content', '')
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            
            hashtags = re.findall(r'#(\w+)', content.lower())
            
            for tag in hashtags:
                hashtag_stats[tag]['count'] += 1
                hashtag_stats[tag]['total_engagement'] += engagement
                hashtag_stats[tag]['posts'].append(post.get('post_id'))
        
        trending = []
        for tag, stats in hashtag_stats.items():
            trending.append({
                'hashtag': f'#{tag}',
                'post_count': stats['count'],
                'total_engagement': stats['total_engagement'],
                'avg_engagement': stats['total_engagement'] / stats['count'] if stats['count'] > 0 else 0,
                'sample_posts': stats['posts'][:5]
            })
        
        trending.sort(key=lambda x: x['total_engagement'], reverse=True)
        
        return trending[:50]
    
    # ===== INFLUENCER IDENTIFICATION =====
    def identify_influencers(self, posts):
        """Score accounts by influence metrics"""
        influencers = defaultdict(lambda: {
            'posts': 0,
            'total_engagement': 0,
            'products_mentioned': set(),
            'brands_mentioned': set(),
            'hashtags_used': set(),
            'platforms': set(),
            'post_ids': []
        })
        
        for post in posts:
            author = post.get('author')
            if not author or author == 'unknown':
                continue
            
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            content = post.get('content', '').lower()
            
            influencers[author]['posts'] += 1
            influencers[author]['total_engagement'] += engagement
            influencers[author]['platforms'].add(post.get('platform', 'unknown'))
            influencers[author]['post_ids'].append(post.get('post_id'))
            
            for product in self.beauty_products:
                if product in content:
                    influencers[author]['products_mentioned'].add(product.title())
            
            for brand in self.beauty_brands:
                if brand in content:
                    influencers[author]['brands_mentioned'].add(brand.title())
            
            hashtags = re.findall(r'#(\w+)', content)
            influencers[author]['hashtags_used'].update(hashtags)
        
        scored_influencers = []
        for author, stats in influencers.items():
            if stats['posts'] < 2:
                continue
            
            avg_engagement = stats['total_engagement'] / stats['posts']
            
            influence_score = (
                avg_engagement * 0.6 +
                stats['posts'] * 100 * 0.25 +
                len(stats['products_mentioned']) * 50 * 0.1 +
                len(stats['hashtags_used']) * 10 * 0.05
            )
            
            scored_influencers.append({
                'handle': author,
                'posts': stats['posts'],
                'total_engagement': stats['total_engagement'],
                'avg_engagement': round(avg_engagement, 1),
                'influence_score': round(influence_score, 2),
                'products_mentioned': list(stats['products_mentioned'])[:5],
                'brands_mentioned': list(stats['brands_mentioned'])[:5],
                'top_hashtags': list(stats['hashtags_used'])[:10],
                'platforms': list(stats['platforms']),
                'sample_post_ids': stats['post_ids'][:3]
            })
        
        scored_influencers.sort(key=lambda x: x['influence_score'], reverse=True)
        
        return scored_influencers[:20]
    
    # ===== BRAND MENTION TRACKING =====
    def track_brand_mentions(self, posts):
        """Count mentions of beauty brands with engagement"""
        brand_stats = defaultdict(lambda: {
            'mention_count': 0,
            'total_engagement': 0,
            'positive_sentiment': 0,
            'negative_sentiment': 0,
            'neutral_sentiment': 0,
            'platforms': defaultdict(int),
            'sample_posts': []
        })
        
        sentiment_results = self.analyze_sentiment_ml(posts)
        sentiment_map = {s['post_id']: s for s in sentiment_results}
        
        for post in posts:
            content = post.get('content', '').lower()
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            platform = post.get('platform', 'unknown')
            post_id = post.get('post_id')
            
            for brand in self.beauty_brands:
                if brand in content:
                    brand_stats[brand.title()]['mention_count'] += 1
                    brand_stats[brand.title()]['total_engagement'] += engagement
                    brand_stats[brand.title()]['platforms'][platform] += 1
                    
                    if post_id in sentiment_map:
                        sentiment = sentiment_map[post_id]['classification']
                        brand_stats[brand.title()][f'{sentiment}_sentiment'] += 1
                    
                    if len(brand_stats[brand.title()]['sample_posts']) < 5:
                        brand_stats[brand.title()]['sample_posts'].append({
                            'post_id': post_id,
                            'content': post.get('content', '')[:100],
                            'engagement': engagement
                        })
        
        brand_mentions = []
        for brand, stats in brand_stats.items():
            total_sentiment = (stats['positive_sentiment'] + 
                             stats['negative_sentiment'] + 
                             stats['neutral_sentiment'])
            
            brand_mentions.append({
                'brand': brand,
                'mention_count': stats['mention_count'],
                'total_engagement': stats['total_engagement'],
                'avg_engagement': round(stats['total_engagement'] / stats['mention_count'], 1) if stats['mention_count'] > 0 else 0,
                'sentiment': {
                    'positive': round(stats['positive_sentiment'] / total_sentiment * 100, 1) if total_sentiment > 0 else 0,
                    'negative': round(stats['negative_sentiment'] / total_sentiment * 100, 1) if total_sentiment > 0 else 0,
                    'neutral': round(stats['neutral_sentiment'] / total_sentiment * 100, 1) if total_sentiment > 0 else 0
                },
                'platforms': dict(stats['platforms']),
                'sample_posts': stats['sample_posts']
            })
        
        brand_mentions.sort(key=lambda x: x['mention_count'], reverse=True)
        
        return brand_mentions