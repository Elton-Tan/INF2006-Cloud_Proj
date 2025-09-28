############################################
# HTTP API + Cognito JWT Authorizer
############################################

# API
resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project}-${var.env}-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_origins     = [var.cloudfront_url, "http://localhost:5173"]
    max_age           = 86400
  }
}

# Stage with auto deploy (no manual deployment resources needed)
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

# Authorizer (Cognito)
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    # Audience must match the App Client ID you created
    audience = [aws_cognito_user_pool_client.spa.id]
    # Issuer is the Cognito User Pool issuer
    issuer = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

# =========================
# Integrations (examples)
# Replace function names with your actual Lambda resources where needed
# =========================

# Enqueue (POST /enqueue)
resource "aws_apigatewayv2_integration" "enqueue" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.enqueue.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# Watchlist (GET /watchlist)
resource "aws_apigatewayv2_integration" "watchlist" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.watchlist_read.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# (If you have public routes like /health, create their integrations too)

# =========================
# Routes
# =========================

# Protected routes (ALL require valid JWT)
locals {
  protected_routes = {
    "POST /enqueue"  = aws_apigatewayv2_integration.enqueue.id
    "GET /watchlist" = aws_apigatewayv2_integration.watchlist.id
    # Add more: "GET /something" = aws_apigatewayv2_integration.something.id
  }

  # Example public routes (keep empty if none)
  public_routes = {
    # "GET /health" = aws_apigatewayv2_integration.health.id
  }
}

resource "aws_apigatewayv2_route" "protected" {
  for_each           = local.protected_routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${each.value}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_route" "public" {
  for_each  = local.public_routes
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.key
  target    = "integrations/${each.value}"
  # No auth here (authorization_type defaults to NONE)
}

# =========================
# Lambda permissions (API → Lambda invoke)
# =========================

resource "aws_lambda_permission" "api_invoke_enqueue" {
  statement_id  = "AllowAPIGInvokeEnqueue"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.enqueue.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_watchlist" {
  statement_id  = "AllowAPIGInvokeWatchlist"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.watchlist_read.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# (Add a lambda_permission per Lambda you integrate)
