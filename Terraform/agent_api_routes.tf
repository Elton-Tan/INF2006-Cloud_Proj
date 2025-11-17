# ============================================
# API Gateway Routes for Agent Functions
# ============================================
# Routes:
# - GET  /agent/permission      -> get-agent-permission
# - POST /agent/permission      -> set-agent-permission (implied from naming)
# - POST /agent/monitoring/start -> agent_monitoring_api
# - GET  /agent/status          -> agent_monitoring_api (status check)
# ============================================

# ---------- HTTP API Gateway Routes ----------
# Assuming you already have an HTTP API Gateway created
# Reference: aws_apigatewayv2_api.http from apigw_http.tf

# Integration: get-agent-permission (GET /agent/permission)
resource "aws_apigatewayv2_integration" "get_agent_permission" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.get_agent_permission.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_agent_permission" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /agent/permission"
  target    = "integrations/${aws_apigatewayv2_integration.get_agent_permission.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Lambda permission for API Gateway to invoke get-agent-permission
resource "aws_lambda_permission" "get_agent_permission_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_agent_permission.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# Integration: set-agent-permission (POST /agent/permission)
resource "aws_apigatewayv2_integration" "set_agent_permission" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.set_agent_permission.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "set_agent_permission" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /agent/permission"
  target    = "integrations/${aws_apigatewayv2_integration.set_agent_permission.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "set_agent_permission_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.set_agent_permission.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# Integration: agent_monitoring_api - start (POST /agent/monitoring/start)
resource "aws_apigatewayv2_integration" "agent_monitoring_start" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.agent_monitoring_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_monitoring_start" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /agent/monitoring/start"
  target    = "integrations/${aws_apigatewayv2_integration.agent_monitoring_start.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "agent_monitoring_start_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_monitoring_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# Integration: agent_monitoring_api - status (GET /agent/status)
resource "aws_apigatewayv2_integration" "agent_status" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.agent_monitoring_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_status" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /agent/status"
  target    = "integrations/${aws_apigatewayv2_integration.agent_status.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Note: Lambda permission already granted above for agent_monitoring_api

# ---------- Optional: Direct invoke route for agentic-flow ----------
# This is optional if you want to expose the agentic-flow function directly via API

resource "aws_apigatewayv2_integration" "agentic_flow" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.agentic_flow.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agentic_flow" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /agent/generate"
  target    = "integrations/${aws_apigatewayv2_integration.agentic_flow.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "agentic_flow_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agentic_flow.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ---------- Outputs ----------

output "agent_api_base_url" {
  description = "Base URL for agent API endpoints"
  value       = "https://${aws_apigatewayv2_api.http.id}.execute-api.${var.region}.amazonaws.com"
}

output "agent_api_endpoints" {
  description = "Agent API endpoints"
  value = {
    get_permission    = "GET /agent/permission"
    set_permission    = "POST /agent/permission"
    monitoring_start  = "POST /agent/monitoring/start"
    status            = "GET /agent/status"
    generate          = "POST /agent/generate"
  }
}
