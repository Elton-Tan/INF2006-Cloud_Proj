#######################################
# Region helper + Tags
#######################################
data "aws_region" "current" {}

locals {
  alarm_tags = {
    Project = var.project
    Env     = var.env
  }
  name = "${var.project}-${var.env}"
}

#######################################
# SNS topic + optional email subs
#######################################
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
  tags = local.alarm_tags
}

resource "aws_sns_topic_subscription" "emails" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

#######################################
# Lambda alarms (for each function)
#######################################
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(var.lambda_functions)
  alarm_name          = "${local.name}-lambda-${each.value}-errors"
  alarm_description   = "Lambda Errors > ${var.lambda_errors_threshold} for 5m"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.lambda_errors_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = toset(var.lambda_functions)
  alarm_name          = "${local.name}-lambda-${each.value}-throttles"
  alarm_description   = "Lambda Throttles > ${var.lambda_throttles_threshold} for 5m"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.lambda_throttles_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration_p95" {
  for_each            = toset(var.lambda_functions)
  alarm_name          = "${local.name}-lambda-${each.value}-duration-p95"
  alarm_description   = "Lambda Duration p95 > ${var.lambda_p95_ms}ms"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = { FunctionName = each.value }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 2
  threshold           = var.lambda_p95_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# SQS alarms (per queue)
#######################################
resource "aws_cloudwatch_metric_alarm" "sqs_depth" {
  for_each            = var.sqs_queues
  alarm_name          = "${local.name}-sqs-${each.key}-depth"
  alarm_description   = "SQS visible messages >= ${var.sqs_depth_threshold} for 10m"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.key }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 10
  threshold           = var.sqs_depth_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "sqs_age_oldest" {
  for_each            = var.sqs_queues
  alarm_name          = "${local.name}-sqs-${each.key}-age-oldest"
  alarm_description   = "AgeOfOldestMessage >= ${var.sqs_age_oldest_sec}s for 5m"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = each.key }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.sqs_age_oldest_sec
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

# Optional: DLQ has messages (indicates poison pills)
resource "aws_cloudwatch_metric_alarm" "sqs_dlq_depth" {
  for_each            = { for q, v in var.sqs_queues : v.dlq_name => v if length(v.dlq_name) > 0 }
  alarm_name          = "${local.name}-sqs-${each.key}-dlq-depth"
  alarm_description   = "DLQ has visible messages"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.key } # each.key is the DLQ name
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# RDS alarms (skip if no RDS)
#######################################
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count               = var.rds_instance_id == "" ? 0 : 1
  alarm_name          = "${local.name}-rds-cpu-high"
  alarm_description   = "RDS CPU >= ${var.rds_cpu_high_pct}% for 5m"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = var.rds_instance_id }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.rds_cpu_high_pct
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_conn" {
  count               = var.rds_instance_id == "" ? 0 : 1
  alarm_name          = "${local.name}-rds-connections-high"
  alarm_description   = "RDS DB connections > ${var.rds_conn_high}"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = var.rds_instance_id }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.rds_conn_high
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  count               = var.rds_instance_id == "" ? 0 : 1
  alarm_name          = "${local.name}-rds-free-storage-low"
  alarm_description   = "RDS free storage < ${var.rds_free_storage_low_mb} MB"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.rds_instance_id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.rds_free_storage_low_mb * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# API Gateway (HTTP API)
#######################################
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = var.api_gateway_id == "" ? 0 : 1
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "HTTP API 5xx errors elevated"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiId = var.api_gateway_id, Stage = var.api_gateway_stage }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.api_5xx_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p95" {
  count               = var.api_gateway_id == "" ? 0 : 1
  alarm_name          = "${local.name}-api-latency-p95"
  alarm_description   = "HTTP API p95 latency too high"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = var.api_gateway_id, Stage = var.api_gateway_stage }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 2
  threshold           = var.api_p95_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# CloudFront
#######################################
resource "aws_cloudwatch_metric_alarm" "cf_5xx_rate" {
  count               = var.cloudfront_distribution_id == "" ? 0 : 1
  alarm_name          = "${local.name}-cf-5xx-rate"
  alarm_description   = "CloudFront 5xx error rate too high"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  dimensions          = { DistributionId = var.cloudfront_distribution_id, Region = "Global" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.cf_5xx_rate_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "cf_latency_p90" {
  count               = var.cloudfront_distribution_id == "" ? 0 : 1
  alarm_name          = "${local.name}-cf-latency-p90"
  alarm_description   = "CloudFront TotalLatency p90 too high"
  namespace           = "AWS/CloudFront"
  metric_name         = "TotalLatency"
  dimensions          = { DistributionId = var.cloudfront_distribution_id, Region = "Global" }
  extended_statistic  = "p90"
  period              = 60
  evaluation_periods  = 2
  threshold           = var.cf_total_latency_p90_ms
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# S3 (requires Request Metrics enabled)
#######################################
resource "aws_cloudwatch_metric_alarm" "s3_5xx" {
  count               = var.s3_bucket_name == "" ? 0 : 1
  alarm_name          = "${local.name}-s3-5xx"
  alarm_description   = "S3 5xx errors elevated (requires request metrics)"
  namespace           = "AWS/S3"
  metric_name         = "5xxErrors"
  dimensions          = { BucketName = var.s3_bucket_name, FilterId = var.s3_request_metrics_filter_id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

resource "aws_cloudwatch_metric_alarm" "s3_4xx_rate" {
  count               = var.s3_bucket_name == "" ? 0 : 1
  alarm_name          = "${local.name}-s3-4xx-rate"
  alarm_description   = "S3 4xx error rate elevated (requires request metrics)"
  namespace           = "AWS/S3"
  metric_name         = "4xxErrors"
  dimensions          = { BucketName = var.s3_bucket_name, FilterId = var.s3_request_metrics_filter_id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# WAF (Regional + CloudFront)
#######################################
# Regional WAF (attach to API Gateway regional or ALB if present)
resource "aws_cloudwatch_metric_alarm" "waf_regional_blocked" {
  alarm_name          = "${local.name}-waf-regional-blocked"
  alarm_description   = "Regional WAF blocked requests > threshold in 5m"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = "${local.name}-regional", Region = data.aws_region.current.name, Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.waf_blocked_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

# CloudFront WAF (Global)
resource "aws_cloudwatch_metric_alarm" "waf_cf_blocked" {
  count               = var.cloudfront_distribution_id == "" ? 0 : 1
  alarm_name          = "${local.name}-waf-cf-blocked"
  alarm_description   = "CloudFront WAF blocked requests > threshold in 5m"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = "${local.name}-cf", Region = "Global", Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.waf_blocked_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# EventBridge (FailedInvocations per rule)
#######################################
resource "aws_cloudwatch_metric_alarm" "events_failed_invocations" {
  for_each            = toset(var.eventbridge_rule_names)
  alarm_name          = "${local.name}-events-${each.value}-failed"
  alarm_description   = "EventBridge FailedInvocations > 0"
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  dimensions          = { RuleName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# Cognito User Pool (optional)
#######################################
resource "aws_cloudwatch_metric_alarm" "cognito_signin_throttles" {
  count               = var.cognito_user_pool_id == "" ? 0 : 1
  alarm_name          = "${local.name}-cognito-signin-throttles"
  alarm_description   = "Cognito SignInThrottles > 0 for 5m"
  namespace           = "AWS/Cognito"
  metric_name         = "SignInThrottles"
  dimensions          = { UserPoolId = var.cognito_user_pool_id }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.alarm_tags
}

#######################################
# Unified CloudWatch Dashboard
#######################################
locals {
  dashboard_widgets_raw = [
    // Row 1: API + Lambda errors
    {
      "type" : "metric", "x" : 0, "y" : 0, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "HTTP API Requests & Errors",
        "view" : "timeSeries", "stacked" : false,
        "metrics" : [
          ["AWS/ApiGateway", "Count", "ApiId", var.api_gateway_id, "Stage", var.api_gateway_stage, { "stat" : "Sum" }],
          [".", "4XXError", ".", ".", ".", ".", { "stat" : "Sum", "yAxis" : "right" }],
          [".", "5XXError", ".", ".", ".", ".", { "stat" : "Sum", "yAxis" : "right" }]
        ],
        "region" : data.aws_region.current.name
      }
    },
    {
      "type" : "metric", "x" : 12, "y" : 0, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "Lambda Errors & Throttles (all)",
        "view" : "timeSeries", "stacked" : false,
        "metrics" : flatten([
          for fn in var.lambda_functions : [
            ["AWS/Lambda", "Errors", "FunctionName", fn, { "stat" : "Sum" }],
            ["AWS/Lambda", "Throttles", "FunctionName", fn, { "stat" : "Sum" }]
          ]
        ]),
        "region" : data.aws_region.current.name
      }
    },

    // Row 2: Latency
    {
      "type" : "metric", "x" : 0, "y" : 6, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "HTTP API Latency (p95)",
        "view" : "timeSeries",
        "metrics" : [["AWS/ApiGateway", "Latency", "ApiId", var.api_gateway_id, "Stage", var.api_gateway_stage, { "stat" : "p95" }]],
        "region" : data.aws_region.current.name
      }
    },
    {
      "type" : "metric", "x" : 12, "y" : 6, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "Lambda Duration (p95) - all",
        "view" : "timeSeries",
        "metrics" : [for fn in var.lambda_functions : ["AWS/Lambda", "Duration", "FunctionName", fn, { "stat" : "p95" }]],
        "region" : data.aws_region.current.name
      }
    },

    // Row 3: SQS health
    {
      "type" : "metric", "x" : 0, "y" : 12, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "SQS Depth & Age",
        "view" : "timeSeries",
        "metrics" : flatten([
          for q, dlq in var.sqs_queues : [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", q, { "stat" : "Average" }],
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", q, { "stat" : "Maximum" }]
          ]
        ]),
        "region" : data.aws_region.current.name
      }
    },

    // Row 4: RDS + WAF (RDS is conditional)
    (var.rds_instance_id == "" ? null : {
      "type" : "metric", "x" : 0, "y" : 18, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "RDS CPU / Connections / Free Storage",
        "view" : "timeSeries", "stacked" : false,
        "metrics" : [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id, { "stat" : "Average" }],
          [".", "DatabaseConnections", ".", ".", { "stat" : "Average", "yAxis" : "right" }],
          [".", "FreeStorageSpace", ".", ".", { "stat" : "Average", "yAxis" : "right" }]
        ],
        "region" : data.aws_region.current.name
      }
    }),
    {
      "type" : "metric", "x" : 12, "y" : 18, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "WAF Blocked Requests (Regional + CF)",
        "view" : "timeSeries",
        "metrics" : [
          ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.name}-regional", "Rule", "ALL", "Region", data.aws_region.current.name, { "stat" : "Sum" }],
          ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.name}-cf", "Rule", "ALL", "Region", "Global", { "stat" : "Sum" }]
        ],
        "region" : data.aws_region.current.name
      }
    },

    // Row 5: CloudFront (conditional) + S3 (conditional)
    (var.cloudfront_distribution_id == "" ? null : {
      "type" : "metric", "x" : 0, "y" : 24, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "CloudFront Requests & 5xx Error Rate",
        "view" : "timeSeries", "stacked" : false,
        "metrics" : [
          ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { "stat" : "Sum" }],
          [".", "5xxErrorRate", ".", ".", ".", ".", { "stat" : "Average", "yAxis" : "right" }],
          [".", "4xxErrorRate", ".", ".", ".", ".", { "stat" : "Average", "yAxis" : "right" }]
        ],
        "region" : "us-east-1"
      }
    }),
    (var.s3_bucket_name == "" ? null : {
      "type" : "metric", "x" : 12, "y" : 24, "width" : 12, "height" : 6,
      "properties" : {
        "title" : "S3 4xx/5xx (request metrics)",
        "view" : "timeSeries", "stacked" : false,
        "metrics" : [
          ["AWS/S3", "4xxErrors", "BucketName", var.s3_bucket_name, "FilterId", var.s3_request_metrics_filter_id, { "stat" : "Average" }],
          [".", "5xxErrors", ".", ".", ".", ".", { "stat" : "Sum", "yAxis" : "right" }]
        ],
        "region" : data.aws_region.current.name
      }
    })
  ]

  dashboard_widgets = [for w in local.dashboard_widgets_raw : w if w != null]
}

resource "aws_cloudwatch_dashboard" "ops" {
  dashboard_name = "${local.name}-ops"
  dashboard_body = jsonencode({
    widgets = local.dashboard_widgets
  })
}
