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
