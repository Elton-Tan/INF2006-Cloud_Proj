# ============================================
# API Gateway Routes for Agent Functions
# Includes core agent routes and the post-social route.
# ============================================

# Assuming you already have an HTTP API Gateway created
# Reference: aws_apigatewayv2_api.http from apigw_http.tf

# NOTE: The aws_lambda_function.post_social_lambda MUST be defined in agent_lambdas.tf (or post_social.tf).

# --- Route Helper Locals ---
locals {
  http_api_id   = aws_apigatewayv2_api.http.id
  authorizer_id = aws_apigatewayv2_authorizer.jwt.id
  execution_arn = aws_apigatewayv2_api.http.execution_arn
}

# --- 1. Core Permission Routes (GET/POST /agent/permission) ---

# GET /agent/permission
resource "aws_apigatewayv2_integration" "get_agent_permission" {
  api_id                 = local.http_api_id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST" # Lambda invocation is always POST, but the route can be GET
  integration_uri        = aws_lambda_function.get_agent_permission.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_agent_permission" {
  api_id    = local.http_api_id
  route_key = "GET /agent/permission"
  target    = "integrations/${aws_apigatewayv2_integration.get_agent_permission.id}"

  authorization_type = "JWT"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "get_agent_permission_apigw" {
  statement_id  = "AllowAPIGatewayInvokeGetPermission"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_agent_permission.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.execution_arn}/*/*"
}

# POST /agent/permission
resource "aws_apigatewayv2_integration" "set_agent_permission" {
  api_id                 = local.http_api_id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.set_agent_permission.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "set_agent_permission" {
  api_id    = local.http_api_id
  route_key = "POST /agent/permission"
  target    = "integrations/${aws_apigatewayv2_integration.set_agent_permission.id}"

  authorization_type = "JWT"
  authorizer_id      = local.authorizer_id
}

resource "aws_lambda_permission" "set_agent_permission_apigw" {
  statement_id  = "AllowAPIGatewayInvokeSetPermission"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.set_agent_permission.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.execution_arn}/*/*"
}


# --- 2. Monitoring and Status Routes ---
# (Assuming these are handled elsewhere or if needed can be added here similarly)


# --- 3. NEW: POST /ad (Post Social) ---

# Note: HTTP API (v2) does not use aws_apigatewayv2_resource. It uses routes directly.
# The "path_part" concept is for REST APIs (v1). For HTTP APIs, we just define the route key.

# Integration: Links /ad path to post_social_lambda
resource "aws_apigatewayv2_integration" "post_social_integration" {
  api_id             = local.http_api_id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  # Target the post-social Lambda (defined in post_social.tf)
  integration_uri        = aws_lambda_function.post_social_lambda.invoke_arn
  payload_format_version = "2.0"
}

# Route: POST /ad
resource "aws_apigatewayv2_route" "post_social_route" {
  api_id    = local.http_api_id
  route_key = "POST /ad"
  target    = "integrations/${aws_apigatewayv2_integration.post_social_integration.id}"
  # Securing the endpoint with the existing JWT authorizer
  authorization_type = "JWT"
  authorizer_id      = local.authorizer_id
}

# Permission: Allows API Gateway to invoke the Lambda
resource "aws_lambda_permission" "post_social_apigw_permission" {
  statement_id  = "AllowAPIGatewayInvokePostSocial"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_social_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.execution_arn}/*/*"
}
