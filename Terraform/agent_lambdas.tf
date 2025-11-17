# ============================================
# Agent Lambda Functions
# ============================================
# Lambda functions for the agent workflow:
# 1. set-agent-permission
# 2. get-agent-permission
# 3. agent_monitoring_api
# 4. agentic-flow
# 5. agent_worker
# ============================================

# ---------- IAM Role for Lambda Functions ----------

resource "aws_iam_role" "agent_lambda_role" {
  name = "${var.project}-agent-lambda-role-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "Agent Lambda Role"
    Environment = var.env
    Project     = var.project
  }
}

# Base Lambda execution policy
resource "aws_iam_role_policy_attachment" "agent_lambda_basic" {
  role       = aws_iam_role.agent_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# VPC execution policy (if your lambdas need VPC access for RDS)
resource "aws_iam_role_policy_attachment" "agent_lambda_vpc" {
  role       = aws_iam_role.agent_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Custom policy for agent lambdas
resource "aws_iam_role_policy" "agent_lambda_permissions" {
  name = "${var.project}-agent-lambda-permissions-${var.env}"
  role = aws_iam_role.agent_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 access for knowledge base and images
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.agent_knowledge_base.arn,
          "${aws_s3_bucket.agent_knowledge_base.arn}/*",
          aws_s3_bucket.agent_images_input.arn,
          "${aws_s3_bucket.agent_images_input.arn}/*",
          aws_s3_bucket.agent_images_output.arn,
          "${aws_s3_bucket.agent_images_output.arn}/*"
        ]
      },
      # DynamoDB access for AgentJobs table
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.agent_jobs.arn,
          "${aws_dynamodb_table.agent_jobs.arn}/index/*"
        ]
      },
      # SQS access for jobs queue
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [
          aws_sqs_queue.agent_jobs_queue.arn
        ]
      },
      # Secrets Manager access
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.gemini_api_key.arn,
          aws_secretsmanager_secret.cognito_oauth.arn,
          var.rds_secret_arn
        ]
      },
      # Bedrock access for KB retrieval and model invocation
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:InvokeModel"
        ]
        Resource = [
          aws_bedrockagent_knowledge_base.agent_kb.arn,
          "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-text-lite-v1",
          "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-text-express-v1"
        ]
      },
      # Bedrock Agent Runtime for KB queries
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate"
        ]
        Resource = "*"
      },
      # API Gateway execute for WebSocket connections
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections",
          "execute-api:Invoke"
        ]
        Resource = "arn:aws:execute-api:${var.region}:${data.aws_caller_identity.current.account_id}:*"
      }
    ]
  })
}

# ---------- Lambda Layer for MySQL (spirulina-MySQL) ----------

# Reference the existing MySQL layer
data "aws_lambda_layer_version" "mysql_layer" {
  layer_name = "spirulina-mysql"
}

# ---------- Lambda Function: set-agent-permission ----------

data "archive_file" "set_agent_permission" {
  type        = "zip"
  source_dir  = "${path.module}/set-agent-permission"
  output_path = "${path.module}/dist/set-agent-permission.zip"
}

resource "aws_lambda_function" "set_agent_permission" {
  filename         = data.archive_file.set_agent_permission.output_path
  function_name    = "${var.project}-set-agent-permission-${var.env}"
  role             = aws_iam_role.agent_lambda_role.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.set_agent_permission.output_base64sha256
  runtime          = "python3.11"
  timeout          = 30
  memory_size      = 256

  layers = [data.aws_lambda_layer_version.mysql_layer.arn]

  environment {
    variables = {
      DB_SECRET = var.rds_secret_arn
      REGION    = var.region
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = var.lambda_security_group_ids
  }

  tags = {
    Name        = "Set Agent Permission"
    Environment = var.env
    Project     = var.project
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "set_agent_permission" {
  name              = "/aws/lambda/${aws_lambda_function.set_agent_permission.function_name}"
  retention_in_days = 7
}

# ---------- Lambda Function: get-agent-permission ----------

data "archive_file" "get_agent_permission" {
  type        = "zip"
  source_dir  = "${path.module}/get-agent-permission"
  output_path = "${path.module}/dist/get-agent-permission.zip"
}

resource "aws_lambda_function" "get_agent_permission" {
  filename         = data.archive_file.get_agent_permission.output_path
  function_name    = "${var.project}-get-agent-permission-${var.env}"
  role             = aws_iam_role.agent_lambda_role.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.get_agent_permission.output_base64sha256
  runtime          = "python3.11"
  timeout          = 30
  memory_size      = 256

  layers = [data.aws_lambda_layer_version.mysql_layer.arn]

  environment {
    variables = {
      DB_NAME_KEY    = "spirulinadb"
      DB_SECRET_ARN  = var.rds_secret_arn
      REGION         = var.region
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = var.lambda_security_group_ids
  }

  tags = {
    Name        = "Get Agent Permission"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_cloudwatch_log_group" "get_agent_permission" {
  name              = "/aws/lambda/${aws_lambda_function.get_agent_permission.function_name}"
  retention_in_days = 7
}

# ---------- Lambda Function: agent_monitoring_api ----------

data "archive_file" "agent_monitoring_api" {
  type        = "zip"
  source_dir  = "${path.module}/agent_monitoring_api"
  output_path = "${path.module}/dist/agent_monitoring_api.zip"
}

resource "aws_lambda_function" "agent_monitoring_api" {
  filename         = data.archive_file.agent_monitoring_api.output_path
  function_name    = "${var.project}-agent-monitoring-api-${var.env}"
  role             = aws_iam_role.agent_lambda_role.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.agent_monitoring_api.output_base64sha256
  runtime          = "python3.11"
  timeout          = 60
  memory_size      = 512

  environment {
    variables = {
      COGNITO_OAUTH_SECRET_ARN = aws_secretsmanager_secret.cognito_oauth.arn
      JOBS_QUEUE_URL           = aws_sqs_queue.agent_jobs_queue.url
      JOBS_TABLE               = aws_dynamodb_table.agent_jobs.name
    }
  }

  tags = {
    Name        = "Agent Monitoring API"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_cloudwatch_log_group" "agent_monitoring_api" {
  name              = "/aws/lambda/${aws_lambda_function.agent_monitoring_api.function_name}"
  retention_in_days = 7
}

# ---------- Lambda Function: agentic-flow ----------

data "archive_file" "agentic_flow" {
  type        = "zip"
  source_dir  = "${path.module}/agentic-flow"
  output_path = "${path.module}/dist/agentic-flow.zip"
}

resource "aws_lambda_function" "agentic_flow" {
  filename         = data.archive_file.agentic_flow.output_path
  function_name    = "${var.project}-agentic-flow-${var.env}"
  role             = aws_iam_role.agent_lambda_role.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.agentic_flow.output_base64sha256
  runtime          = "python3.11"
  timeout          = 300  # 5 minutes for image generation
  memory_size      = 1024

  environment {
    variables = {
      GEMINI_SECRET_ARN = aws_secretsmanager_secret.gemini_api_key.arn
      IMAGE_BUCKET      = aws_s3_bucket.agent_images_input.id
      IMAGE_MODEL_ID    = "amazon.titan-image-generator-v2:0"
      KB_ID             = aws_bedrockagent_knowledge_base.agent_kb.id
      KB_MODEL_ARN      = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-text-express-v1"
      OUTPUT_BUCKET     = aws_s3_bucket.agent_images_output.id
      TEXT_MODEL_ID     = "amazon.titan-text-lite-v1"
      BEDROCK_REGION    = var.region
    }
  }

  tags = {
    Name        = "Agentic Flow"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_cloudwatch_log_group" "agentic_flow" {
  name              = "/aws/lambda/${aws_lambda_function.agentic_flow.function_name}"
  retention_in_days = 7
}

# ---------- Lambda Function: agent_worker ----------

data "archive_file" "agent_worker" {
  type        = "zip"
  source_dir  = "${path.module}/agent_worker"
  output_path = "${path.module}/dist/agent_worker.zip"
}

resource "aws_lambda_function" "agent_worker" {
  filename         = data.archive_file.agent_worker.output_path
  function_name    = "${var.project}-agent-worker-${var.env}"
  role             = aws_iam_role.agent_lambda_role.arn
  handler          = "handler.lambda_handler"
  source_code_hash = data.archive_file.agent_worker.output_base64sha256
  runtime          = "python3.11"
  timeout          = 900  # 15 minutes for long-running jobs
  memory_size      = 1024

  environment {
    variables = {
      API_BASE            = "https://${aws_apigatewayv2_api.http.id}.execute-api.${var.region}.amazonaws.com"
      JOBS_TABLE          = aws_dynamodb_table.agent_jobs.name
      PURGE_BEFORE_WRITE  = "True"
      S3_BUCKET           = aws_s3_bucket.agent_knowledge_base.id
      S3_PREFIX           = "env/prod"
      WS_API_URL          = "wss://${aws_apigatewayv2_api.ws.id}.execute-api.${var.region}.amazonaws.com/${var.env}"
    }
  }

  tags = {
    Name        = "Agent Worker"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_cloudwatch_log_group" "agent_worker" {
  name              = "/aws/lambda/${aws_lambda_function.agent_worker.function_name}"
  retention_in_days = 7
}

# SQS trigger for agent_worker
resource "aws_lambda_event_source_mapping" "agent_worker_sqs" {
  event_source_arn = aws_sqs_queue.agent_jobs_queue.arn
  function_name    = aws_lambda_function.agent_worker.arn
  batch_size       = 1
  enabled          = true
}

# ---------- Outputs ----------

output "bedrock_kb_id" {
  description = "Bedrock Knowledge Base ID"
  value       = aws_bedrockagent_knowledge_base.agent_kb.id
}

output "bedrock_kb_arn" {
  description = "Bedrock Knowledge Base ARN"
  value       = aws_bedrockagent_knowledge_base.agent_kb.arn
}

output "agent_kb_bucket" {
  description = "S3 bucket for knowledge base data"
  value       = aws_s3_bucket.agent_knowledge_base.id
}

output "agent_images_input_bucket" {
  description = "S3 bucket for input images"
  value       = aws_s3_bucket.agent_images_input.id
}

output "agent_images_output_bucket" {
  description = "S3 bucket for generated images"
  value       = aws_s3_bucket.agent_images_output.id
}

output "agent_jobs_queue_url" {
  description = "SQS queue URL for agent jobs"
  value       = aws_sqs_queue.agent_jobs_queue.url
}

output "agent_jobs_table_name" {
  description = "DynamoDB table name for agent jobs"
  value       = aws_dynamodb_table.agent_jobs.name
}

output "set_agent_permission_lambda_arn" {
  description = "ARN of set-agent-permission Lambda"
  value       = aws_lambda_function.set_agent_permission.arn
}

output "get_agent_permission_lambda_arn" {
  description = "ARN of get-agent-permission Lambda"
  value       = aws_lambda_function.get_agent_permission.arn
}

output "agent_monitoring_api_lambda_arn" {
  description = "ARN of agent-monitoring-api Lambda"
  value       = aws_lambda_function.agent_monitoring_api.arn
}

output "agentic_flow_lambda_arn" {
  description = "ARN of agentic-flow Lambda"
  value       = aws_lambda_function.agentic_flow.arn
}

output "agent_worker_lambda_arn" {
  description = "ARN of agent-worker Lambda"
  value       = aws_lambda_function.agent_worker.arn
}
