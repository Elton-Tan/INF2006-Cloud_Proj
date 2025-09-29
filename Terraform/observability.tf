############################################
# SNS topic for alarm notifications
############################################
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-${var.env}-alerts"
}

# Optional email subscriptions
resource "aws_sns_topic_subscription" "emails" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.key
}

locals {
  alarm_tags = {
    Project = var.project
    Env     = var.env
  }
}

############################################
# --- ALB & Target Group alarms
############################################

# ALB 5XX spike (load balancer generated 5xx)
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project}-${var.env}-alb-5xx"
  alarm_description   = "ALB 5xx count over threshold in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.alb_5xx_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  statistic           = "Sum"
  period              = 300

  dimensions = {
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# Target 5XX spike (from instances)
resource "aws_cloudwatch_metric_alarm" "tg_5xx" {
  alarm_name          = "${var.project}-${var.env}-tg-5xx"
  alarm_description   = "Target 5xx responses elevated"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.alb_5xx_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  statistic           = "Sum"
  period              = 300

  dimensions = {
    TargetGroup  = aws_lb_target_group.app.arn_suffix
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# Unhealthy targets > 0 for 2 consecutive periods
resource "aws_cloudwatch_metric_alarm" "tg_unhealthy" {
  alarm_name          = "${var.project}-${var.env}-tg-unhealthy"
  alarm_description   = "Unhealthy targets detected"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 0
  treat_missing_data  = "notBreaching"
  metric_name         = "UnhealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  statistic           = "Average"
  period              = 60

  dimensions = {
    TargetGroup  = aws_lb_target_group.app.arn_suffix
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# P90 target response time too high
resource "aws_cloudwatch_metric_alarm" "tg_latency_p90" {
  alarm_name          = "${var.project}-${var.env}-tg-latency-p90"
  alarm_description   = "P90 target response time > threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.alb_target_response_p90_ms / 1000.0
  treat_missing_data  = "notBreaching"
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  extended_statistic  = "p90"
  period              = 60

  dimensions = {
    TargetGroup  = aws_lb_target_group.app.arn_suffix
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

############################################
# --- Auto Scaling Group health/coverage
############################################

# In-service instances below desired (capacity shortfall)
# Uses GroupInServiceInstances vs GroupDesiredCapacity
resource "aws_cloudwatch_metric_alarm" "asg_capacity_shortfall" {
  alarm_name          = "${var.project}-${var.env}-asg-capacity-shortfall"
  alarm_description   = "InService < Desired for 2 periods"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  threshold           = 0
  treat_missing_data  = "breaching"
  metric_name         = "GroupInServiceInstances"
  namespace           = "AWS/AutoScaling"
  statistic           = "Average"
  period              = 60

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.app.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

############################################
# --- CloudFront distribution
############################################

# CloudFront 5xx error rate > X%
resource "aws_cloudwatch_metric_alarm" "cf_5xx_rate" {
  alarm_name          = "${var.project}-${var.env}-cf-5xx-rate"
  alarm_description   = "CloudFront 5xx error rate too high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.cf_5xx_rate_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  statistic           = "Average"
  period              = 300

  dimensions = {
    DistributionId = aws_cloudfront_distribution.app.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# CloudFront P90 total latency exceeds threshold
resource "aws_cloudwatch_metric_alarm" "cf_latency_p90" {
  alarm_name          = "${var.project}-${var.env}-cf-latency-p90"
  alarm_description   = "CloudFront P90 TotalLatency too high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.cf_total_latency_p90_ms
  treat_missing_data  = "notBreaching"
  metric_name         = "TotalLatency"
  namespace           = "AWS/CloudFront"
  extended_statistic  = "p90"
  period              = 60

  dimensions = {
    DistributionId = aws_cloudfront_distribution.app.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

############################################
# --- API Gateway HTTP API ($default stage)
############################################

# NOTE: We created/attached the stage in waf_regional.tf as aws_apigatewayv2_stage.http_default

# 5xx count above threshold in 5 minutes
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project}-${var.env}-api-5xx"
  alarm_description   = "HTTP API 5xx errors elevated"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.api_5xx_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  statistic           = "Sum"
  period              = 300

  dimensions = {
    ApiId = aws_apigatewayv2_api.http.id
    Stage = aws_apigatewayv2_stage.http_default.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# P95 latency too high
resource "aws_cloudwatch_metric_alarm" "api_latency_p95" {
  alarm_name          = "${var.project}-${var.env}-api-latency-p95"
  alarm_description   = "HTTP API P95 latency > threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.api_latency_p95_ms
  treat_missing_data  = "notBreaching"
  metric_name         = "Latency"
  namespace           = "AWS/ApiGateway"
  extended_statistic  = "p95"
  period              = 60

  dimensions = {
    ApiId = aws_apigatewayv2_api.http.id
    Stage = aws_apigatewayv2_stage.http_default.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

############################################
# --- WAF signals
############################################

# Blocked requests spike (regional WAF attached to ALB + API)
resource "aws_cloudwatch_metric_alarm" "waf_regional_blocked" {
  alarm_name          = "${var.project}-${var.env}-waf-regional-blocked"
  alarm_description   = "REGIONAL WAF blocked > threshold in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.waf_blocked_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  statistic           = "Sum"
  period              = 300

  dimensions = {
    WebACL = aws_wafv2_web_acl.regional.name
    Region = data.aws_region.current.name
    Rule   = "ALL"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

# Blocked requests spike (CloudFront WAF)
resource "aws_cloudwatch_metric_alarm" "waf_cf_blocked" {
  alarm_name          = "${var.project}-${var.env}-waf-cf-blocked"
  alarm_description   = "CLOUDFRONT WAF blocked > threshold in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.waf_blocked_threshold
  treat_missing_data  = "notBreaching"
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  statistic           = "Sum"
  period              = 300

  dimensions = {
    WebACL = aws_wafv2_web_acl.cf.name
    Region = "Global"
    Rule   = "ALL"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.alarm_tags
}

data "aws_region" "current" {}

############################################
# --- Unified CloudWatch Dashboard
############################################
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project}-${var.env}-ops"
  dashboard_body = jsonencode({
    widgets = [
      # Row 1: Traffic & errors
      {
        "type" : "metric", "x" : 0, "y" : 0, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "ALB Requests & 5xx",
          "view" : "timeSeries", "stacked" : false,
          "metrics" : [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.app.arn_suffix, { "stat" : "Sum" }],
            [".", "HTTPCode_ELB_5XX_Count", ".", ".", { "stat" : "Sum", "yAxis" : "right" }],
            [".", "HTTPCode_Target_5XX_Count", "TargetGroup", aws_lb_target_group.app.arn_suffix, "LoadBalancer", aws_lb.app.arn_suffix, { "stat" : "Sum", "yAxis" : "right" }]
          ],
          "region" : data.aws_region.current.name,
          "yAxis" : { "left" : { "label" : "Requests" }, "right" : { "label" : "5xx" } }
        }
      },
      {
        "type" : "metric", "x" : 12, "y" : 0, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "CloudFront Error Rate & Requests",
          "view" : "timeSeries", "stacked" : false,
          "metrics" : [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.app.id, "Region", "Global", { "stat" : "Sum" }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { "stat" : "Average", "yAxis" : "right" }],
            [".", "4xxErrorRate", ".", ".", ".", ".", { "stat" : "Average", "yAxis" : "right" }]
          ],
          "region" : "us-east-1"
        }
      },

      # Row 2: Latency
      {
        "type" : "metric", "x" : 0, "y" : 6, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "Target Response Time (p90)",
          "view" : "timeSeries",
          "metrics" : [
            ["AWS/ApplicationELB", "TargetResponseTime", "TargetGroup", aws_lb_target_group.app.arn_suffix, "LoadBalancer", aws_lb.app.arn_suffix, { "stat" : "p90" }]
          ],
          "region" : data.aws_region.current.name
        }
      },
      {
        "type" : "metric", "x" : 12, "y" : 6, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "CloudFront TotalLatency (p90)",
          "view" : "timeSeries",
          "metrics" : [
            ["AWS/CloudFront", "TotalLatency", "DistributionId", aws_cloudfront_distribution.app.id, "Region", "Global", { "stat" : "p90" }]
          ],
          "region" : "us-east-1"
        }
      },

      # Row 3: API health
      {
        "type" : "metric", "x" : 0, "y" : 12, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "HTTP API Requests & Errors",
          "view" : "timeSeries", "stacked" : false,
          "metrics" : [
            ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.http.id, "Stage", aws_apigatewayv2_stage.http_default.name, { "stat" : "Sum" }],
            [".", "4XXError", ".", ".", ".", ".", { "stat" : "Sum", "yAxis" : "right" }],
            [".", "5XXError", ".", ".", ".", ".", { "stat" : "Sum", "yAxis" : "right" }]
          ],
          "region" : data.aws_region.current.name
        }
      },
      {
        "type" : "metric", "x" : 12, "y" : 12, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "HTTP API Latency (p95)",
          "view" : "timeSeries",
          "metrics" : [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.http.id, "Stage", aws_apigatewayv2_stage.http_default.name, { "stat" : "p95" }]
          ],
          "region" : data.aws_region.current.name
        }
      },

      # Row 4: Capacity & WAF
      {
        "type" : "metric", "x" : 0, "y" : 18, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "ASG Capacity",
          "view" : "timeSeries",
          "metrics" : [
            ["AWS/AutoScaling", "GroupDesiredCapacity", "AutoScalingGroupName", aws_autoscaling_group.app.name, { "stat" : "Average" }],
            [".", "GroupInServiceInstances", ".", ".", { "stat" : "Average" }],
            [".", "GroupPendingInstances", ".", ".", { "stat" : "Average" }]
          ],
          "region" : data.aws_region.current.name
        }
      },
      {
        "type" : "metric", "x" : 12, "y" : 18, "width" : 12, "height" : 6,
        "properties" : {
          "title" : "WAF Blocked Requests",
          "view" : "timeSeries", "stacked" : false,
          "metrics" : [
            ["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.regional.name, "Rule", "ALL", "Region", data.aws_region.current.name, { "stat" : "Sum" }],
            [".", "BlockedRequests", "WebACL", aws_wafv2_web_acl.cf.name, "Rule", "ALL", "Region", "Global", { "stat" : "Sum" }]
          ],
          "region" : data.aws_region.current.name
        }
      }
    ]
  })
}
