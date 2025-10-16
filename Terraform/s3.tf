# S3 bucket for Lambda layers
resource "aws_s3_bucket" "lambda_layers" {
  bucket = "${var.project}-lambda-layers-${var.env}"
  
  tags = {
    Name        = "Lambda Layers Storage"
    Environment = var.env
  }
}

# Block all public access (IMPORTANT!)
resource "aws_s3_bucket_public_access_block" "lambda_layers" {
  bucket = aws_s3_bucket.lambda_layers.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning (optional but good practice)
resource "aws_s3_bucket_versioning" "lambda_layers" {
  bucket = aws_s3_bucket.lambda_layers.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption (security best practice)
resource "aws_s3_bucket_server_side_encryption_configuration" "lambda_layers" {
  bucket = aws_s3_bucket.lambda_layers.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}