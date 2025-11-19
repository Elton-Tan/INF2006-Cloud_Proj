# ============================================
# Variables for Agent Infrastructure
# ============================================
# Add these to your terraform.tfvars file
# ============================================

# NOTE: Your existing variables.tf already has:
# - var.project (not project_name)
# - var.env (not environment)
# - var.region
# These have been referenced correctly in the agent Terraform files.

variable "rds_secret_arn" {
  description = "ARN of the RDS secret containing database credentials"
  type        = string
  # Example: "arn:aws:secretsmanager:us-east-1:123456789012:secret:spirulina-rds-secret-abc123"
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for Lambda functions that need VPC access to RDS"
  type        = list(string)
  # These should be subnets with access to RDS
  # Get these from: terraform output or AWS Console EC2 > Subnets
}

variable "lambda_security_group_ids" {
  description = "List of security group IDs for Lambda functions"
  type        = list(string)
  # Security groups should allow:
  # - Outbound to RDS (port 3306)
  # - Outbound to internet for AWS services (https/443)
}
