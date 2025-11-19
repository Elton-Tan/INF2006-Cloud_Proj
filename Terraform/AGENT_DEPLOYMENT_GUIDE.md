# Agent Infrastructure Deployment Guide

This guide explains how to deploy the Bedrock-powered agent infrastructure using Terraform.

## Overview

The agent infrastructure includes:

1. **Bedrock Knowledge Base** with Amazon Titan Embedding V2
2. **OpenSearch Serverless** for vector storage
3. **S3 Buckets** for knowledge base data, input images, and output images
4. **Lambda Functions** for agent operations:
   - `set-agent-permission` - Set user permissions for agent access
   - `get-agent-permission` - Get user permissions
   - `agent_monitoring_api` - Start agent jobs and check status
   - `agentic-flow` - Generate marketing content using Bedrock KB + Gemini
   - `agent_worker` - Process agent jobs from SQS queue
5. **DynamoDB Table** for agent job tracking
6. **SQS Queue** for asynchronous job processing
7. **Secrets Manager** for API keys and OAuth secrets
8. **API Gateway Routes** for agent endpoints

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│     API Gateway (HTTP + WS)         │
│  - GET  /agent/permission           │
│  - POST /agent/permission           │
│  - POST /agent/monitoring/start     │
│  - GET  /agent/status               │
│  - POST /agent/generate             │
└──────┬──────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│           Lambda Functions                   │
│  ┌────────────────────────────────────────┐  │
│  │  set/get-agent-permission (RDS)        │  │
│  │  agent_monitoring_api (SQS+DynamoDB)   │  │
│  │  agentic-flow (Bedrock KB + Gemini)    │  │
│  │  agent_worker (Process jobs)           │  │
│  └────────────────────────────────────────┘  │
└──────┬───────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│         Bedrock Knowledge Base               │
│  - Embedding: Titan Embedding V2             │
│  - Vector Store: OpenSearch Serverless       │
│  - Data Source: S3                           │
└──────────────────────────────────────────────┘
```

## Prerequisites

1. **Terraform** >= 1.0
2. **AWS CLI** configured with appropriate credentials
3. **Existing Infrastructure**:
   - VPC with private subnets (for Lambda-RDS connectivity)
   - RDS database with secret in Secrets Manager
   - API Gateway (HTTP and WebSocket)
   - Cognito User Pool for authentication

## Files Created

- `bedrock_agent.tf` - Bedrock KB, S3 buckets, OpenSearch Serverless, DynamoDB, SQS, Secrets
- `agent_lambdas.tf` - All 5 Lambda functions with IAM roles
- `agent_api_routes.tf` - API Gateway integrations and routes
- `agent_variables.tf` - Required variables

## Step-by-Step Deployment

### Step 1: Update terraform.tfvars

Add the following variables to your `terraform.tfvars`:

```hcl
# RDS Secret ARN (from your existing RDS setup)
rds_secret_arn = "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:YOUR_RDS_SECRET"

# VPC Configuration (for Lambda functions that access RDS)
private_subnet_ids = [
  "subnet-xxxxx",
  "subnet-yyyyy"
]

lambda_security_group_ids = [
  "sg-xxxxx"  # Should allow outbound to RDS
]

# Project Configuration (if not already defined)
project_name = "spirulina"
environment  = "prod"
region       = "us-east-1"
```

### Step 2: Initialize Terraform

```bash
cd Terraform
terraform init
```

### Step 3: Plan the Deployment

**IMPORTANT: DO NOT APPLY YET** - Review the plan first:

```bash
terraform plan -out=agent.tfplan
```

Review the plan to ensure:
- No existing resources will be destroyed
- All new resources are correctly configured
- Variable values are correct

### Step 4: Apply (When Ready)

**WARNING: The infrastructure is already deployed on AWS. These Terraform files are for documentation and future updates only.**

If you need to apply changes:

```bash
terraform apply agent.tfplan
```

### Step 5: Post-Deployment Configuration

#### 5.1 Update Secrets Manager

The secrets are created with placeholder values. Update them:

```bash
# Update Gemini API Key
aws secretsmanager update-secret \
  --secret-id spirulina-gemini-api-key-prod \
  --secret-string '{"api-key":"YOUR_ACTUAL_GEMINI_API_KEY"}'

# Update Cognito OAuth Secret
aws secretsmanager update-secret \
  --secret-id spirulina-cognito-oauth-prod \
  --secret-string '{"client_secret":"YOUR_ACTUAL_COGNITO_SECRET"}'
```

#### 5.2 Upload Knowledge Base Data

Upload your brand documents to the knowledge base S3 bucket:

```bash
# Get bucket name from outputs
KB_BUCKET=$(terraform output -raw agent_kb_bucket)

# Upload documents
aws s3 cp ./brand-documents/ s3://$KB_BUCKET/env/prod/ --recursive
```

#### 5.3 Sync Knowledge Base

After uploading documents, trigger a sync:

```bash
# Get KB ID
KB_ID=$(terraform output -raw bedrock_kb_id)

# Start ingestion job
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id $KB_ID \
  --data-source-id YOUR_DATA_SOURCE_ID
```

#### 5.4 Upload Reference Images

Upload product images to the input bucket:

```bash
# Get bucket name
INPUT_BUCKET=$(terraform output -raw agent_images_input_bucket)

# Upload images
aws s3 cp ./product-images/ s3://$INPUT_BUCKET/ --recursive
```

### Step 6: Test the Endpoints

Get the API base URL:

```bash
terraform output agent_api_base_url
```

Test endpoints:

```bash
# Get API Gateway URL
API_URL=$(terraform output -raw agent_api_base_url)

# Test get permission (with Cognito JWT token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  $API_URL/agent/permission

# Test agent generation
curl -X POST $API_URL/agent/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "image_key": "Spirulina Cream.jpg",
    "product_query": "Foot cream for dry, cracked heels"
  }'
```

## Configuration Details

### Bedrock Knowledge Base

- **Embedding Model**: `amazon.titan-embed-text-v2:0` (Titan Embedding V2)
- **Vector Store**: OpenSearch Serverless with VECTORSEARCH collection type
- **Chunking Strategy**: Fixed size with 300 tokens, 20% overlap
- **Vector Index**: `bedrock-knowledge-base-index`

### Lambda Functions

| Function | Timeout | Memory | VPC | Layers | Purpose |
|----------|---------|--------|-----|--------|---------|
| set-agent-permission | 30s | 256 MB | Yes | MySQL | Set user permissions in RDS |
| get-agent-permission | 30s | 256 MB | Yes | MySQL | Get user permissions from RDS |
| agent_monitoring_api | 60s | 512 MB | No | None | Start jobs, check status |
| agentic-flow | 5m | 1 GB | No | None | Generate marketing content |
| agent_worker | 15m | 1 GB | No | None | Process async jobs |

### Environment Variables

#### agentic-flow
```
GEMINI_SECRET_ARN = Secrets Manager ARN for Gemini API key
IMAGE_BUCKET      = S3 bucket for input images
IMAGE_MODEL_ID    = amazon.titan-image-generator-v2:0
KB_ID             = Bedrock Knowledge Base ID
KB_MODEL_ARN      = arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-express-v1
OUTPUT_BUCKET     = S3 bucket for generated images
TEXT_MODEL_ID     = amazon.titan-text-lite-v1
BEDROCK_REGION    = us-east-1
```

#### agent_worker
```
API_BASE           = API Gateway HTTP URL
JOBS_TABLE         = AgentJobs (DynamoDB table)
PURGE_BEFORE_WRITE = True
S3_BUCKET          = Knowledge base S3 bucket
S3_PREFIX          = env/prod
WS_API_URL         = WebSocket API URL
```

#### agent_monitoring_api
```
COGNITO_OAUTH_SECRET_ARN = Cognito OAuth secret ARN
JOBS_QUEUE_URL           = SQS queue URL
JOBS_TABLE               = AgentJobs
```

#### get/set-agent-permission
```
DB_SECRET_ARN = RDS secret ARN
DB_NAME_KEY   = spirulinadb
REGION        = us-east-1
```

## API Endpoints

### GET /agent/permission
Get current user's agent permissions.

**Response:**
```json
{
  "hasPermission": true,
  "features": ["generate", "monitor"]
}
```

### POST /agent/permission
Set user's agent permissions.

**Request:**
```json
{
  "userId": "user123",
  "permissions": ["generate", "monitor"]
}
```

### POST /agent/monitoring/start
Start a new agent job.

**Request:**
```json
{
  "jobType": "generate_marketing",
  "parameters": {
    "image_key": "product.jpg",
    "product_query": "Anti-aging serum"
  }
}
```

**Response:**
```json
{
  "jobId": "job-123-456",
  "status": "queued"
}
```

### GET /agent/status
Check status of agent jobs.

**Query Parameters:**
- `jobId` - Specific job ID to check

**Response:**
```json
{
  "jobId": "job-123-456",
  "status": "completed",
  "result": {
    "slogan": "Transform your skin overnight",
    "output_bucket": "spirulina-agent-images-output-prod",
    "output_key": "generated/product-1234567890.png"
  }
}
```

### POST /agent/generate
Directly generate marketing content (synchronous).

**Request:**
```json
{
  "image_key": "Spirulina Cream.jpg",
  "product_query": "Foot cream for dry, cracked heels",
  "custom_prompt": "Luxury spa setting with soft lighting"
}
```

**Response:**
```json
{
  "slogan": "Heal and nourish your feet naturally",
  "output_bucket": "spirulina-agent-images-output-prod",
  "output_key": "generated/Spirulina-Cream-1234567890.png"
}
```

## Cost Estimation

### Monthly Costs (approximate, for moderate usage):

- **OpenSearch Serverless**: ~$700/month (2 OCUs)
- **Bedrock Titan Embedding V2**: ~$0.0001 per 1K tokens
- **Bedrock Titan Text**: ~$0.0003 per 1K tokens
- **Lambda**: ~$5-20/month (depends on usage)
- **S3**: ~$5-10/month (depends on data volume)
- **DynamoDB**: ~$1-5/month (on-demand)
- **SQS**: ~$0.40/month (first 1M requests free)
- **Secrets Manager**: ~$1/month (2 secrets)

**Total estimated**: ~$720-750/month

**Note**: OpenSearch Serverless is the main cost driver. Consider using Amazon Aurora with pgvector if cost is a concern.

## Troubleshooting

### Lambda Timeout Issues
- Increase timeout for `agentic-flow` or `agent_worker` if jobs take longer
- Check CloudWatch Logs for specific errors

### Knowledge Base Not Returning Results
- Verify data source sync completed: `aws bedrock-agent list-ingestion-jobs --knowledge-base-id KB_ID`
- Check S3 bucket has documents in correct format
- Ensure OpenSearch Serverless collection is active

### Permission Errors
- Verify IAM roles have correct policies
- Check Lambda execution role can access Bedrock, S3, Secrets Manager
- Ensure Bedrock KB role can read from S3 and invoke embedding model

### API Gateway 403 Errors
- Verify Cognito JWT token is valid
- Check authorizer is configured correctly
- Ensure CORS is enabled if calling from browser

## Monitoring

### CloudWatch Dashboards

Monitor key metrics:
- Lambda invocations, errors, duration
- SQS queue depth
- DynamoDB read/write capacity
- Bedrock model invocations

### CloudWatch Logs

Log groups created:
- `/aws/lambda/spirulina-set-agent-permission-prod`
- `/aws/lambda/spirulina-get-agent-permission-prod`
- `/aws/lambda/spirulina-agent-monitoring-api-prod`
- `/aws/lambda/spirulina-agentic-flow-prod`
- `/aws/lambda/spirulina-agent-worker-prod`

### Alerts

Set up CloudWatch Alarms for:
- Lambda errors > threshold
- SQS DLQ message count > 0
- DynamoDB throttling events
- Lambda duration approaching timeout

## Security Best Practices

1. **Secrets Management**
   - Rotate secrets regularly
   - Never commit secrets to version control
   - Use IAM policies to restrict secret access

2. **Network Security**
   - Keep Lambda functions in private subnets when accessing RDS
   - Use security groups to restrict traffic
   - Enable VPC endpoints for AWS services

3. **API Security**
   - Always use Cognito authorization
   - Enable WAF rules for API Gateway
   - Implement rate limiting

4. **Data Security**
   - Enable S3 bucket encryption
   - Use S3 bucket policies to restrict access
   - Enable versioning for audit trail

## Cleanup (If Needed)

To destroy all resources (USE WITH CAUTION):

```bash
# This will delete everything!
terraform destroy
```

For selective cleanup:

```bash
# Remove specific resource
terraform destroy -target=aws_lambda_function.agentic_flow
```

## Support

For issues or questions:
1. Check CloudWatch Logs
2. Review Terraform plan output
3. Consult AWS Bedrock documentation
4. Review lambda handler code for logic errors

## Additional Resources

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Titan Embedding V2 Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [OpenSearch Serverless Vector Search](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vector-search.html)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
