# DB credentials secret (JSON as your worker expects)
resource "aws_secretsmanager_secret" "db" {
  name = "${var.project}/db"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.mysql.address
    port     = 3306
    username = var.db_username
    password = random_password.db.result
    database = var.db_name
  })
}

# Scraper API secret (string or JSON with key "Scrapper-API" like your code)
resource "aws_secretsmanager_secret" "scraper" {
  name = "${var.project}/scraper"
}

resource "aws_secretsmanager_secret_version" "scraper" {
  secret_id     = aws_secretsmanager_secret.scraper.id
  secret_string = jsonencode({ "Scrapper-API" = var.scrapingbee_secret_value })
}


# ✅ NEW: Social scraper API secret (for your Instagram scraping)
resource "aws_secretsmanager_secret" "social_scraper" {  # ← Different name!
  name = "${var.project}/social-scraper"  # ← Different secret name!
}

resource "aws_secretsmanager_secret_version" "social_scraper" {  # ← Different name!
  secret_id     = aws_secretsmanager_secret.social_scraper.id
  secret_string = jsonencode({ 
    "api_key" = var.scrapingbee_secret_value  # Uses same variable but different key name
  })
}

resource "aws_secretsmanager_secret" "facebook_app_id" {  # ← Different name!
  name = "${var.project}/facebook_app_id"  # ← Different secret name!
}

resource "aws_secretsmanager_secret_version" "facebook_app_id" {  # ← Different name!
  secret_id     = aws_secretsmanager_secret.facebook_app_id.id
  secret_string = jsonencode({ 
    "api_key" = var.facebook_app_id  # Uses same variable but different key name
  })
}

resource "aws_secretsmanager_secret" "instagram_app_id" {  # ← Different name!
  name = "${var.project}/instagram_app_id"  # ← Different secret name!
}

resource "aws_secretsmanager_secret_version" "instagram_app_id" {  # ← Different name!
  secret_id     = aws_secretsmanager_secret.instagram_app_id.id
  secret_string = jsonencode({ 
    "api_key" = var.instagram_app_id  # Uses same variable but different key name
  })
}