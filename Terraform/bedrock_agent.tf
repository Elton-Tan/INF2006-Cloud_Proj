# ============================================
# Bedrock Agent Infrastructure
# ============================================
# This file configures:
# - Bedrock Knowledge Base with Titan Embedding V2
# - S3 buckets for knowledge base data and images
# - IAM roles and policies
# - Lambda functions for agent workflow
# - Supporting infrastructure (DynamoDB, SQS, Secrets)
# ============================================

# ---------- S3 Buckets ----------

# Knowledge Base data source bucket
resource "aws_s3_bucket" "agent_knowledge_base" {
  bucket = "${var.project}-agent-kb-${var.env}"

  tags = {
    Name        = "Agent Knowledge Base"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_s3_bucket_versioning" "agent_knowledge_base" {
  bucket = aws_s3_bucket.agent_knowledge_base.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Image input bucket (reference images)
resource "aws_s3_bucket" "agent_images_input" {
  bucket = "${var.project}-agent-images-input-${var.env}"

  tags = {
    Name        = "Agent Input Images"
    Environment = var.env
    Project     = var.project
  }
}

# Image output bucket (generated images)
resource "aws_s3_bucket" "agent_images_output" {
  bucket = "${var.project}-agent-images-output-${var.env}"

  tags = {
    Name        = "Agent Output Images"
    Environment = var.env
    Project     = var.project
  }
}

# CORS for output bucket (if needed for frontend access)
resource "aws_s3_bucket_cors_configuration" "agent_images_output" {
  bucket = aws_s3_bucket.agent_images_output.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ---------- IAM Role for Bedrock Knowledge Base ----------

resource "aws_iam_role" "bedrock_kb_role" {
  name = "${var.project}-bedrock-kb-role-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "Bedrock Knowledge Base Role"
    Environment = var.env
    Project     = var.project
  }
}

# Policy for Bedrock to access S3 and invoke embedding model
resource "aws_iam_role_policy" "bedrock_kb_policy" {
  name = "${var.project}-bedrock-kb-policy-${var.env}"
  role = aws_iam_role.bedrock_kb_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.agent_knowledge_base.arn,
          "${aws_s3_bucket.agent_knowledge_base.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
        ]
      }
    ]
  })
}

# ---------- Bedrock Knowledge Base ----------

resource "aws_bedrockagent_knowledge_base" "agent_kb" {
  name     = "${var.project}-agent-kb-${var.env}"
  role_arn = aws_iam_role.bedrock_kb_role.arn

  description = "Knowledge base for agent marketing content generation using Titan Embedding V2"

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"

    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.agent_kb_collection.arn
      vector_index_name = "bedrock-knowledge-base-index"

      field_mapping {
        vector_field   = "bedrock-knowledge-base-default-vector"
        text_field     = "AMAZON_BEDROCK_TEXT_CHUNK"
        metadata_field = "AMAZON_BEDROCK_METADATA"
      }
    }
  }

  tags = {
    Name        = "Agent Knowledge Base"
    Environment = var.env
    Project     = var.project
  }
}

# ---------- OpenSearch Serverless for Vector Store ----------

# Encryption policy for OpenSearch Serverless
resource "aws_opensearchserverless_security_policy" "agent_kb_encryption" {
  name = "${var.project}-kb-encrypt-${var.env}"
  type = "encryption"

  policy = jsonencode({
    Rules = [
      {
        Resource = [
          "collection/${var.project}-agent-kb-${var.env}"
        ]
        ResourceType = "collection"
      }
    ]
    AWSOwnedKey = true
  })
}

# Network policy for OpenSearch Serverless
resource "aws_opensearchserverless_security_policy" "agent_kb_network" {
  name = "${var.project}-kb-network-${var.env}"
  type = "network"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource = [
            "collection/${var.project}-agent-kb-${var.env}"
          ]
          ResourceType = "collection"
        }
      ]
      AllowFromPublic = true
    }
  ])
}

# Data access policy for OpenSearch Serverless
resource "aws_opensearchserverless_access_policy" "agent_kb_data_access" {
  name = "${var.project}-kb-data-${var.env}"
  type = "data"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource = [
            "collection/${var.project}-agent-kb-${var.env}"
          ]
          Permission = [
            "aoss:CreateCollectionItems",
            "aoss:DeleteCollectionItems",
            "aoss:UpdateCollectionItems",
            "aoss:DescribeCollectionItems"
          ]
          ResourceType = "collection"
        },
        {
          Resource = [
            "index/${var.project}-agent-kb-${var.env}/*"
          ]
          Permission = [
            "aoss:CreateIndex",
            "aoss:DeleteIndex",
            "aoss:UpdateIndex",
            "aoss:DescribeIndex",
            "aoss:ReadDocument",
            "aoss:WriteDocument"
          ]
          ResourceType = "index"
        }
      ]
      Principal = [
        aws_iam_role.bedrock_kb_role.arn,
        data.aws_caller_identity.current.arn
      ]
    }
  ])
}

# OpenSearch Serverless Collection
resource "aws_opensearchserverless_collection" "agent_kb_collection" {
  name = "${var.project}-agent-kb-${var.env}"
  type = "VECTORSEARCH"

  description = "Vector search collection for Bedrock Knowledge Base"

  depends_on = [
    aws_opensearchserverless_security_policy.agent_kb_encryption,
    aws_opensearchserverless_security_policy.agent_kb_network
  ]

  tags = {
    Name        = "Agent KB Collection"
    Environment = var.env
    Project     = var.project
  }
}

# ---------- Data Source for Knowledge Base ----------

resource "aws_bedrockagent_data_source" "agent_kb_s3_source" {
  name              = "${var.project}-kb-s3-source-${var.env}"
  knowledge_base_id = aws_bedrockagent_knowledge_base.agent_kb.id

  description = "S3 data source for agent knowledge base"

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn = aws_s3_bucket.agent_knowledge_base.arn

      # Optional: specify prefix if you want to use a specific folder
      # inclusion_prefixes = ["env/prod/"]
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"

      fixed_size_chunking_configuration {
        max_tokens         = 300
        overlap_percentage = 20
      }
    }
  }
}

# ---------- DynamoDB Table for Agent Jobs ----------

resource "aws_dynamodb_table" "agent_jobs" {
  name         = "AgentJobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "Agent Jobs Table"
    Environment = var.env
    Project     = var.project
  }
}

# ---------- SQS Queue for Agent Monitoring ----------

resource "aws_sqs_queue" "agent_jobs_queue" {
  name                       = "${var.project}-agent-jobs-${var.env}"
  visibility_timeout_seconds = 900  # 15 minutes for long-running jobs
  message_retention_seconds  = 1209600  # 14 days
  receive_wait_time_seconds  = 20  # Long polling

  tags = {
    Name        = "Agent Jobs Queue"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_sqs_queue" "agent_jobs_dlq" {
  name = "${var.project}-agent-jobs-dlq-${var.env}"

  tags = {
    Name        = "Agent Jobs DLQ"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_sqs_queue_redrive_policy" "agent_jobs_queue_redrive" {
  queue_url = aws_sqs_queue.agent_jobs_queue.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.agent_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# ---------- Secrets Manager ----------

# Gemini API Key Secret (you'll need to populate this manually)
resource "aws_secretsmanager_secret" "gemini_api_key" {
  name        = "${var.project}-gemini-api-key-${var.env}"
  description = "Gemini API key for Nano Banana image generation"

  tags = {
    Name        = "Gemini API Key"
    Environment = var.env
    Project     = var.project
  }
}

# Placeholder - you need to set the actual value via AWS Console or CLI
resource "aws_secretsmanager_secret_version" "gemini_api_key" {
  secret_id     = aws_secretsmanager_secret.gemini_api_key.id
  secret_string = jsonencode({
    "api-key" = "REPLACE_WITH_YOUR_GEMINI_API_KEY"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Cognito OAuth Secret (you'll need to populate this manually)
resource "aws_secretsmanager_secret" "cognito_oauth" {
  name        = "${var.project}-cognito-oauth-${var.env}"
  description = "Cognito OAuth client secret"

  tags = {
    Name        = "Cognito OAuth Secret"
    Environment = var.env
    Project     = var.project
  }
}

# Placeholder - you need to set the actual value
resource "aws_secretsmanager_secret_version" "cognito_oauth" {
  secret_id     = aws_secretsmanager_secret.cognito_oauth.id
  secret_string = jsonencode({
    "client_secret" = "REPLACE_WITH_YOUR_COGNITO_CLIENT_SECRET"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------- Data Sources ----------

data "aws_caller_identity" "current" {}
