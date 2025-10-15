############################################
# Regional WAF for ALB and API Gateway v2
############################################

# WAF for Regional resources (ALB, API Gateway)
resource "aws_wafv2_web_acl" "regional" {
  name  = "${var.project}-${var.env}-regional-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-${var.env}-regional-waf"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    override_action {
      none {}
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "Common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit1000Per5Min"
    priority = 10
    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }
    action {
      block {}
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }
}


# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "alb_assoc" {
  resource_arn = aws_lb.app.arn
  web_acl_arn  = aws_wafv2_web_acl.regional.arn
}

# Create a stage for your HTTP API (attach WAF to stage)
# If you already have a stage, reuse it; otherwise this creates $default
resource "aws_apigatewayv2_stage" "http_default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

# Associate WAF with API Gateway HTTP API stage
resource "aws_wafv2_web_acl_association" "apigw_assoc" {
  resource_arn = aws_apigatewayv2_stage.http_default.arn
  web_acl_arn  = aws_wafv2_web_acl.regional.arn
}
