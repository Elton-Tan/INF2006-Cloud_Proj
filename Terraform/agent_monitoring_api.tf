# Get the main API Gateway ID and Authorizer ID (assumed defined/passed via locals or data sources)
# Locals are defined in agent_api_routes.tf

# --- 1. /agent/monitoring/start - POST (Queues a new job) ---
resource "aws_apigatewayv2_integration" "monitoring_start_integration" {
  api_id                 = local.http_api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.agent_monitoring_api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "monitoring_start_route" {
  api_id             = local.http_api_id
  route_key          = "POST /agent/monitoring/start"
  target             = "integrations/${aws_apigatewayv2_integration.monitoring_start_integration.id}"
  authorization_type = "JWT"
  authorizer_id      = local.authorizer_id
}

# --- 2. /agent/status - GET (Checks job status) ---
# Reuses the agent_monitoring_api Lambda
resource "aws_apigatewayv2_integration" "agent_status_integration" {
  api_id                 = local.http_api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.agent_monitoring_api.invoke_arn
  integration_method     = "POST" # All proxy integrations map to POST internally
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_status_route" {
  api_id             = local.http_api_id
  route_key          = "GET /agent/status"
  target             = "integrations/${aws_apigatewayv2_integration.agent_status_integration.id}"
  authorizer_id      = local.authorizer_id
  authorization_type = "JWT"
}

# --- Lambda Permission to be invoked by API Gateway (Needed once per Lambda) ---
resource "aws_lambda_permission" "apigw_invoke_monitoring" {
  statement_id  = "AllowAPIGatewayInvokeMonitoring"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_monitoring_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.execution_arn}/*/*"
}
