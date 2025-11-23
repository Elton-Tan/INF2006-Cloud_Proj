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
from datetime import datetime
import time

try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False
    print("Warning: rapidfuzz not installed, using basic brand matching")

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

        self.beauty_brands = {
            'sephora': ['sephora', 'sephor', 'sephorah', '@sephora', '#sephora'],
            'ulta': ['ulta', 'ultabeauty', '@ultabeauty', '#ulta'],
            'glossier': ['glossier', 'glossy', '@glossier'],
            'fenty': ['fenty', 'fentybeauty', 'fenty beauty', '@fentybeauty'],
            'rare beauty': ['rare beauty', 'rarebeauty', '@rarebeauty'],
            'cerave': ['cerave', 'cera ve', '@cerave'],
            'neutrogena': ['neutrogena', '@neutrogena'],
            'the ordinary': ['the ordinary', 'theordinary', '@theordinary', 'ordinary'],
            'drunk elephant': ['drunk elephant', 'drunkelephant', '@drunkelephant']
        }
        self.beauty_products = ['serum', 'moisturizer', 'cleanser', 'foundation', 
                               'lipstick', 'mascara', 'toner', 'sunscreen', 'concealer', 'Spirulina']
        

        # ✅ NEW: Sarcasm indicators
        self.sarcasm_indicators = {
            'emojis': ['🙄', '😒', '💀', '😬', '🤡'],
            'phrases': ['totally', 'obviously', 'sure', 'yeah right', 'great', 'love how', 'perfect']
        }

        self.negative_beauty_terms = [
            'expensive', 'overpriced', 'waste', 'broke out', 'breakout', 'irritated',
            'irritation', 'worst', 'horrible', 'terrible', 'disappointed', 'regret',
            'allergic', 'reaction', 'rash', 'burning', 'stinging'
        ]
        
        self.positive_beauty_terms = [
            'holy grail', 'amazing', 'love', 'obsessed', 'glowing', 'flawless',
            'perfect', 'recommend', 'repurchase', 'favorite', 'best'
        ]
        
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
            if not content or len(content) < 10:
                continue
            try:
                    # Use VADER instead of TextBlob
                    scores = self.sentiment_analyzer.polarity_scores(content)
                    compound = scores['compound']  # -1 to 1

                    content_lower = content.lower()

                    # ✅ Sarcasm detection
                    sarcasm_score = 0
                    for emoji in self.sarcasm_indicators['emojis']:
                        if emoji in content:
                            sarcasm_score += 1
                    
                    for phrase in self.sarcasm_indicators['phrases']:
                        if phrase in content_lower:
                            sarcasm_score += 0.5
                    
                    is_sarcastic = sarcasm_score >= 1.5
                    
                    # ✅ Domain-specific adjustments
                    negative_count = sum(1 for term in self.negative_beauty_terms if term in content_lower)
                    positive_count = sum(1 for term in self.positive_beauty_terms if term in content_lower)
                    
                    # Adjust compound score
                    compound += (positive_count * 0.15) - (negative_count * 0.2)
                    
                    # Flip if sarcastic
                    if is_sarcastic and compound > 0:
                        compound *= -0.8  # Flip but reduce magnitude (sarcasm uncertainty)
                    
                    # Clamp to [-1, 1]
                    compound = max(-1, min(1, compound))

                    
                    # Map compound score to classification
                    if compound >= 0.1:
                        classification = 'positive'
                    elif compound <= -0.1:
                        classification = 'negative'
                    else:
                        classification = 'neutral'
                    
                    result = {
                        'post_id': post.get('post_id'),
                        'label': classification,
                        'score': abs(compound),
                        'classification': classification,
                        'is_sarcastic': is_sarcastic,
                        'engagement': post.get('like_count', 0) + post.get('comment_count', 0)
                    }
                    results.append(result)
            except Exception as e:
                    print(f"Error analyzing sentiment for post {post.get('post_id')}: {e}")
    
        return results
              

    # ===== NAMED ENTITY RECOGNITION =====
    def extract_entities_ml(self, posts):
        """Extract products, brands with fuzzy brand  matching"""
        entity_mentions = []
        
        for post in posts:
            content = post.get('content', '').lower()
            if not content:
                continue
                
            products = []
            brands = []

            for product in self.beauty_products:
                if product in content:
                    products.append(product.title())
            if HAS_RAPIDFUZZ:
                brands = self._detect_brands_fuzzy(content)
            else: 
                brands = self._detect_brands_exact(content)
            
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
    
    def _detect_brands_fuzzy(self, content):
        """Fuzzy brand matching with rapidfuzz"""
        detected = set()
        words = re.findall(r'[@#]?\w+', content.lower())
        
        for brand_key, variations in self.beauty_brands.items():
            for word in words:
                # Exact match on variations
                if word in variations:
                    detected.add(brand_key.title())
                    break
                
                # Fuzzy match (for typos)
                for variation in variations:
                    if len(word) > 4 and fuzz.ratio(word, variation) > 85:
                        detected.add(brand_key.title())
                        break
        
        return list(detected)
    
    def _detect_brands_exact(self, content):
        """Fallback exact matching"""
        detected = set()
        for brand_key, variations in self.beauty_brands.items():
            for variation in variations:
                if variation in content:
                    detected.add(brand_key.title())
                    break
        return list(detected)
    
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
            'posts': [],
            'timestamps': []
        })
        
        for post in posts:
            content = post.get('content', '')
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            timestamp = post.get('timestamp', int(time.time()))

            hashtags = re.findall(r'#(\w+)', content.lower())
            
            for tag in hashtags:
                hashtag_stats[tag]['count'] += 1
                hashtag_stats[tag]['total_engagement'] += engagement
                hashtag_stats[tag]['posts'].append(post.get('post_id'))
                hashtag_stats[tag]['timestamps'].append(timestamp)
                
        now = time.time()
        trending = []
        trending = []
        for tag, stats in hashtag_stats.items():

            # Time-based segmentation
            recent_24h = [i for i, ts in enumerate(stats['timestamps']) if now - ts < 86400]
            recent_7d = [i for i, ts in enumerate(stats['timestamps']) if now - ts < 604800]
            
            count_24h = len(recent_24h)
            count_7d = len(recent_7d)
            
            # Calculate velocity (growth rate)
            if count_7d > 0:
                daily_avg_7d = count_7d / 7
                velocity = count_24h / max(daily_avg_7d, 0.1)  # Avoid division by zero
            else:
                velocity = 1.0
            
            # ✅ Trending score = velocity * total_engagement
            trending_score = velocity * stats['total_engagement'] * 0.01

            trending.append({
                'hashtag': f'#{tag}',
                'post_count': stats['count'],
                'total_engagement': stats['total_engagement'],
                'avg_engagement': stats['total_engagement'] / stats['count'] if stats['count'] > 0 else 0,
                'velocity': round(velocity, 2),
                'trending_score': round(trending_score, 2),
                'sample_posts': stats['posts'][:5]
            })
        
        trending.sort(key=lambda x: x['trending_score'], reverse=True)
        
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
            'post_ids': [],
            'timestamps':[]
        })
        
        for post in posts:
            author = post.get('author')
            if not author or author == 'unknown':
                continue
            
            engagement = post.get('like_count', 0) + post.get('comment_count', 0)
            content = post.get('content', '').lower()
            timestamp = post.get('timestamp', int(time.time()))
            
            influencers[author]['posts'] += 1
            influencers[author]['total_engagement'] += engagement
            influencers[author]['platforms'].add(post.get('platform', 'unknown'))
            influencers[author]['post_ids'].append(post.get('post_id'))
            influencers[author]['timestamps'].append(timestamp)

            for product in self.beauty_products:
                if product in content:
                    influencers[author]['products_mentioned'].add(product.title())
          
            if HAS_RAPIDFUZZ:
                brands = self._detect_brands_fuzzy(content)
            else:
                brands = self._detect_brands_exact(content)
            
            for brand in brands:
                influencers[author]['brands_mentioned'].add(brand)
            
            hashtags = re.findall(r'#(\w+)', content)
            influencers[author]['hashtags_used'].update(hashtags)
        
        scored_influencers = []
        now = time.time()

        for author, stats in influencers.items():
            if stats['posts'] < 2:
                continue
            
            avg_engagement = stats['total_engagement'] / stats['posts']
            
            estimated_followers = avg_engagement / 0.03  # Assume 3% engagement rate
            engagement_rate = avg_engagement / max(estimated_followers, 1)
            post_consistency = min(stats['posts'] / 30, 1.0)
            content_quality = avg_engagement
            if stats['timestamps']:
                days_since_last = (now - max(stats['timestamps'])) / 86400
                recency_factor = max(0.3, 1 - (days_since_last / 90))  # Decay over 90 days
            else:
                recency_factor = 0.5
            
            influence_score = (
                engagement_rate * 10000 * 0.40 +      # Engagement rate (most important)
                post_consistency * 500 * 0.25 +       # Consistency
                content_quality * 0.20 +              # Content quality
                len(stats['brands_mentioned']) * 50 * 0.10 +  # Brand authority
                recency_factor * 200 * 0.05  
            )
            
            scored_influencers.append({
                'handle': author,
                'posts': stats['posts'],
                'total_engagement': stats['total_engagement'],
                'avg_engagement': round(avg_engagement, 1),
                'engagement_rate': round(engagement_rate * 100, 2),  # As percentage
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