# This file defines the 'post-social' Lambda function and the API Gateway route 
# that exposes it as POST /ad.

# --- 1. Lambda Function Definition ---
resource "aws_lambda_function" "post_social_lambda" {
  function_name = "post-social"
  # Handler name is confirmed from the provided Python file (handler.py)
  handler = "handler.lambda_handler"
  runtime = "python3.11"
  # NOTE: The execution role must allow Secrets Manager read access for the token.
  role        = aws_iam_role.agent_lambda_role.arn
  timeout     = 60 # Set higher timeout due to external network calls (Graph API)
  memory_size = 512

  # VPC Configuration (MANDATORY, as it fetches Secrets over VPC Endpoint)
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = var.lambda_security_group_ids
  }

  # Deployment package (Replace with the path where you build the zip)
  filename         = "dist/post-social.zip"
  source_code_hash = filebase64sha256("dist/post-social.zip") # Must match the zipped content

  # Environment Variables (Required by the Python handler.py)
  environment {
    variables = {
      # The secret containing the access token must be defined in Secrets Manager.
      # The Lambda's IAM role must have permission to read this ARN.
      FB_PAGE_ACCESS_TOKEN_SECRET_ARN = var.fb_page_access_token_arn
      FB_PAGE_ID                      = var.fb_page_id
      IG_USER_ID                      = var.ig_user_id
      REGION                          = var.region
    }
  }
}
