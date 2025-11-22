region                   = "us-east-1"
alert_emails = ["2401545@sit.singaporetech.edu.sg"]

lambda_functions = [
  "spirulina-dev-watchlist-read",
  "spirulina-dev-watchlist-series",
  "spirulina-dev-delete-watchlist",
  "spirulina-dev-enqueue",
  "spirulina-dev-schedule-enqueue",
  "spirulina-dev-worker",
  "spirulina-dev-trends-daily",
  "spirulina-dev-trends-forecast",
  "spirulina-dev-trends-keywords-read",
  "spirulina-dev-trends-keywords-write",
  "spirulina-dev-connect",
  "spirulina-dev-disconnect",
]




sqs_queues = {
  "spirulina-dev-jobs" = { dlq_name = "spirulina-dlq" }
}

rds_instance_id              = "spirulina-mysql"
cognito_user_pool_id         = "us-east-1_8waOkdoUR"
s3_bucket_name               = "frontendspirulina"
s3_request_metrics_filter_id = "EntireBucket"
cloudfront_distribution_id   = "E1ZAVK5SPV7779"
api_gateway_id               = "sa0cp2a3r8"
api_gateway_stage            = "dev"
eventbridge_rule_names = [
  "spirulina-dev-every-4h",
  "spirulina-train-daily",
  "spirulina-trend-daily"
]

rds_secret_arn = "arn:aws:secretsmanager:us-east-1:063331379930:secret:spirulina/db-FPuMQT"

private_subnet_ids = ["subnet-0f4c643307c8f2687", "subnet-0af43a4539acfddcb"]

lambda_security_group_ids = ["sg-0b9b0b16700e6e65f"]