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

# Stage with auto deploy
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

# Authorizer (Cognito → JWT)
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.spa.id] # app client ID
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

# =========================
# Integrations
# =========================

# POST /enqueue
resource "aws_apigatewayv2_integration" "enqueue" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.enqueue.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# GET /watchlist
resource "aws_apigatewayv2_integration" "watchlist" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.watchlist_read.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# DELETE /watchlist
resource "aws_apigatewayv2_integration" "delete_watchlist" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.delete_watchlist.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# =========================
# Routes (protected + public)
# =========================

locals {
  # All JWT-protected routes
  protected_routes = {
    "POST /enqueue"     = aws_apigatewayv2_integration.enqueue.id
    "GET /watchlist"    = aws_apigatewayv2_integration.watchlist.id
    "DELETE /watchlist" = aws_apigatewayv2_integration.delete_watchlist.id
  }

  # Add public routes if any (empty by default)
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
  # If you enforce scopes, uncomment and set:
  # authorization_scopes = ["watchlist.delete"] # for DELETE route, etc.
}

resource "aws_apigatewayv2_route" "public" {
  for_each  = local.public_routes
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.key
  target    = "integrations/${each.value}"
}

# =========================
# Lambda permissions (API → Lambda invoke)
# =========================

locals {
  # Function names for permissions
  lambda_permissions = {
    enqueue          = aws_lambda_function.enqueue.function_name
    watchlist_read   = aws_lambda_function.watchlist_read.function_name
    delete_watchlist = aws_lambda_function.delete_watchlist.function_name
  }
}

resource "aws_lambda_permission" "api_invoke" {
  for_each      = local.lambda_permissions
  statement_id  = "AllowAPIGInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
