output "rds_endpoint" { value = aws_db_instance.mysql.address }
output "db_secret_arn" { value = aws_secretsmanager_secret.db.arn }
output "scraper_secret_arn" { value = aws_secretsmanager_secret.scraper.arn }
output "sqs_queue_url" { value = aws_sqs_queue.main.id }
output "http_api_base_url" { value = aws_apigatewayv2_api.http.api_endpoint }
output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "app_asg_name" {
  value = aws_autoscaling_group.app.name
}

output "regional_waf_arn" {
  value = aws_wafv2_web_acl.regional.arn
}

output "api_stage_arn" {
  value = aws_apigatewayv2_stage.http_default.arn
}

