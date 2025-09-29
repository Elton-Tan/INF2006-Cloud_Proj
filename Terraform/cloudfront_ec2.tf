############################################
# CloudFront → ALB origin
# - Uses default CloudFront cert (no custom domain)
# - Attaches a WAFv2 (scope=CLOUDFRONT)
############################################

# WAF for CloudFront
resource "aws_wafv2_web_acl" "cf" {
  name  = "${var.project}-${var.env}-cf-waf"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-${var.env}-cf-waf"
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
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    override_action {
      none {}
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "BadInputs"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_cloudfront_distribution" "app" {
  enabled = true
  comment = "${var.project}-${var.env}-cf-to-alb"

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # ALB listener is HTTP:80
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "alb-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]

    forwarded_values {
      query_string = true
      headers      = ["Host", "Origin", "Authorization", "Content-Type"]
      cookies { forward = "all" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }

  web_acl_id = aws_wafv2_web_acl.cf.arn

  tags = { Name = "${var.project}-${var.env}-cf" }
}


output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.app.domain_name
}
