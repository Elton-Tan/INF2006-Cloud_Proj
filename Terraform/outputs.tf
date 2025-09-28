output "rds_endpoint" { value = aws_db_instance.mysql.address }
output "db_secret_arn" { value = aws_secretsmanager_secret.db.arn }
output "scraper_secret_arn" { value = aws_secretsmanager_secret.scraper.arn }
output "sqs_queue_url" { value = aws_sqs_queue.main.id }
output "http_api_base_url" { value = aws_apigatewayv2_api.http.api_endpoint }
