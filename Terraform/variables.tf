variable "project" {
  type = string
}
variable "env" {
  type = string
}
variable "region" {
  type = string
}
variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
variable "public_subnet_a_cidr" {
  type    = string
  default = "10.20.1.0/24"
}
variable "public_subnet_b_cidr" {
  type    = string
  default = "10.20.2.0/24"
}
variable "private_subnet_a_cidr" {
  type    = string
  default = "10.20.11.0/24"
}
variable "private_subnet_b_cidr" {
  type    = string
  default = "10.20.12.0/24"
}
variable "cloudfront_url" {
  type = string
} # e.g. "https://d84l1y8p4kdic.cloudfront.net/"

variable "ssh_public_key" {
  description = "Your SSH public key for the bastion (contents of id_rsa.pub or ed25519.pub)"
  type        = string
}

variable "db_name" {
  description = "Initial database name for RDS"
  type        = string
}

variable "db_username" {
  description = "Master username for RDS"
  type        = string
}

variable "scrapingbee_secret_value" {
  description = "ScrapingBee (or scraper) API key value to store in Secrets Manager"
  type        = string
  sensitive   = true
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the bastion (e.g., your IP/32)"
  type        = string
  default     = "0.0.0.0/0" # tighten this!
}

# ASG/ALB params
variable "app_instance_type" {
  description = "Instance type for app ASG"
  type        = string
  default     = "t3.micro"
}

variable "app_min_size" {
  type    = number
  default = 2
}

variable "app_max_size" {
  type    = number
  default = 4
}

variable "app_desired_capacity" {
  type    = number
  default = 2
}

variable "alb_target_response_p90_ms" {
  type    = number
  default = 1500
}


variable "api_latency_p95_ms" {
  type    = number
  default = 1200
}

variable "alb_5xx_threshold" {
  type    = number
  default = 10
}


variable "app_health_check_path" {
  description = "ALB target health check path"
  type        = string
  default     = "/"
}

variable "alert_emails" {
  description = "Emails to subscribe to alarm notifications"
  type        = list(string)
  default     = []
}

variable "existing_alb_name" {
  type    = string
  default = "spirulina-dev-alb"
}

variable "existing_tg_name" {
  type    = string
  default = "spirulina-dev-tg"
}

variable "bastion_key_name" {
  type    = string
  default = null
}

# variables.tf
variable "awswrangler_layer_arn" {
  type        = string
  description = "AWS-managed pandas+numpy layer ARN"
}


variable "lambda_functions" {
  description = "Lambda function names to alarm on (Errors/Throttles/Duration)"
  type        = list(string)
  default     = []
}

variable "sqs_queues" {
  description = "Map of SQS queue names to their DLQ name (empty string if none)"
  type = map(object({
    dlq_name = string
  }))
  default = {}
}

variable "rds_instance_id" {
  description = "DBInstanceIdentifier; leave empty to disable RDS alarms"
  type        = string
  default     = ""
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID (ap-southeast-1_XXXX); empty to skip"
  type        = string
  default     = ""
}

variable "s3_bucket_name" {
  description = "S3 bucket with Request Metrics enabled; empty to skip"
  type        = string
  default     = ""
}

variable "s3_request_metrics_filter_id" {
  description = "S3 request-metrics filter ID (often 'EntireBucket')"
  type        = string
  default     = "EntireBucket"
}

variable "cloudfront_distribution_id" {
  description = "CloudFront distribution ID; empty to skip"
  type        = string
  default     = ""
}

variable "api_gateway_id" {
  description = "HTTP API (API Gateway v2) ID; empty to skip"
  type        = string
  default     = ""
}

variable "api_gateway_stage" {
  description = "HTTP API stage name"
  type        = string
  default     = "$default"
}

variable "eventbridge_rule_names" {
  description = "EventBridge rule names to monitor for FailedInvocations"
  type        = list(string)
  default     = []
}

#######################################
# Thresholds (tune per env)
#######################################
variable "rds_cpu_high_pct" {
  description = "RDS CPU high threshold (%)"
  type        = number
  default     = 70
}

variable "rds_free_storage_low_mb" {
  description = "RDS free storage low threshold (MB)"
  type        = number
  default     = 2048 # 2 GB
}

variable "rds_conn_high" {
  description = "RDS database connections high threshold"
  type        = number
  default     = 80
}

variable "lambda_errors_threshold" {
  description = "Lambda Errors sum per minute that triggers alarm"
  type        = number
  default     = 0
}

variable "lambda_throttles_threshold" {
  description = "Lambda Throttles sum per minute that triggers alarm"
  type        = number
  default     = 0
}

variable "lambda_p95_ms" {
  description = "Lambda p95 duration threshold (ms)"
  type        = number
  default     = 2000
}

variable "sqs_depth_threshold" {
  description = "SQS ApproximateNumberOfMessagesVisible threshold"
  type        = number
  default     = 100
}

variable "sqs_age_oldest_sec" {
  description = "SQS ApproximateAgeOfOldestMessage threshold (seconds)"
  type        = number
  default     = 300
}

variable "cf_5xx_rate_threshold" {
  description = "CloudFront 5xx error rate threshold (percent)"
  type        = number
  default     = 1
}

variable "cf_total_latency_p90_ms" {
  description = "CloudFront TotalLatency p90 threshold (ms)"
  type        = number
  default     = 800
}

variable "api_5xx_threshold" {
  description = "API Gateway 5xx sum threshold (per 5 minutes)"
  type        = number
  default     = 5
}

variable "api_p95_ms" {
  description = "API Gateway p95 latency threshold (ms)"
  type        = number
  default     = 1500
}

variable "waf_blocked_threshold" {
  description = "WAF BlockedRequests sum threshold (per 5 minutes)"
  type        = number
  default     = 100
}

variable "fb_page_id" {
  description = "Facebook Page ID"
  type        = string
}

variable "ig_user_id" {
  description = "Instagram User ID"
  type        = string
}

variable "rds_secret_arn" {
  description = "ARN of the secret containing RDS credentials"
  type        = string
}

variable "fb_page_access_token_arn" {
  description = "ARN of the secret containing the FB Page Access Token"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for Lambda functions that need VPC access to RDS"
  type        = list(string)
}

variable "lambda_security_group_ids" {
  description = "List of security group IDs for Lambda functions"
  type        = list(string)
}

variable "instagram_app_id" {
  description = "Instagram App ID"
  type        = string
}

variable "facebook_app_id" {
  description = "Facebook App ID"
  type        = string
}