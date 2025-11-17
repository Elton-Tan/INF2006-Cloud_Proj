# Agent Infrastructure - Quick Reference

## Files Created

1. **bedrock_agent.tf** - Core Bedrock infrastructure
2. **agent_lambdas.tf** - Lambda function definitions
3. **agent_api_routes.tf** - API Gateway integrations
4. **agent_variables.tf** - Variable definitions
5. **AGENT_DEPLOYMENT_GUIDE.md** - Comprehensive deployment guide

## Key Resources

### Bedrock Configuration

| Resource | Value |
|----------|-------|
| **Embedding Model** | `amazon.titan-embed-text-v2:0` (Titan Embedding V2) |
| **Vector Store** | OpenSearch Serverless (VECTORSEARCH) |
| **Text Model** | `amazon.titan-text-lite-v1` / `amazon.titan-text-express-v1` |
| **Data Source** | S3 Bucket |
| **Chunking** | Fixed size: 300 tokens, 20% overlap |

### S3 Buckets

```
{project}-agent-kb-{env}              # Knowledge base data
{project}-agent-images-input-{env}    # Reference images
{project}-agent-images-output-{env}   # Generated images
```

### Lambda Functions

| Function | Handler | Runtime | Timeout | Memory |
|----------|---------|---------|---------|--------|
| set-agent-permission | handler.lambda_handler | python3.11 | 30s | 256MB |
| get-agent-permission | handler.lambda_handler | python3.11 | 30s | 256MB |
| agent_monitoring_api | handler.lambda_handler | python3.11 | 60s | 512MB |
| agentic-flow | handler.lambda_handler | python3.11 | 300s | 1GB |
| agent_worker | handler.lambda_handler | python3.11 | 900s | 1GB |

### API Endpoints

```
GET  /agent/permission         → get-agent-permission
POST /agent/permission         → set-agent-permission
POST /agent/monitoring/start   → agent_monitoring_api
GET  /agent/status            → agent_monitoring_api
POST /agent/generate          → agentic-flow
```

### DynamoDB Tables

```
AgentJobs
  - Hash Key: jobId (S)
  - GSI: StatusIndex (status, createdAt)
  - TTL: enabled
```

### SQS Queues

```
{project}-agent-jobs-{env}        # Main queue
{project}-agent-jobs-dlq-{env}    # Dead letter queue
```

## Environment Variables Reference

### agentic-flow
```bash
GEMINI_SECRET_ARN     # Gemini API key secret
IMAGE_BUCKET          # Input images S3 bucket
IMAGE_MODEL_ID        # amazon.titan-image-generator-v2:0
KB_ID                 # Bedrock KB ID (auto-populated)
KB_MODEL_ARN          # Titan text model ARN
OUTPUT_BUCKET         # Output images S3 bucket
TEXT_MODEL_ID         # amazon.titan-text-lite-v1
BEDROCK_REGION        # us-east-1
```

### agent_worker
```bash
API_BASE              # HTTP API Gateway URL
JOBS_TABLE            # AgentJobs
PURGE_BEFORE_WRITE    # True
S3_BUCKET             # KB S3 bucket
S3_PREFIX             # env/prod
WS_API_URL            # WebSocket API URL
```

### agent_monitoring_api
```bash
COGNITO_OAUTH_SECRET_ARN  # Cognito secret
JOBS_QUEUE_URL            # SQS queue URL
JOBS_TABLE                # AgentJobs
```

### set/get-agent-permission
```bash
DB_SECRET_ARN         # RDS secret (set-agent-permission uses DB_SECRET)
DB_NAME_KEY           # spirulinadb
REGION                # us-east-1
```

## Required terraform.tfvars

```hcl
rds_secret_arn = "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:NAME"
private_subnet_ids = ["subnet-xxx", "subnet-yyy"]
lambda_security_group_ids = ["sg-xxx"]
project_name = "spirulina"
environment = "prod"
region = "us-east-1"
```

## Important Commands

### Deploy (DO NOT RUN - Already Deployed!)
```bash
terraform plan -out=agent.tfplan
terraform apply agent.tfplan
```

### Update Secrets
```bash
# Gemini API Key
aws secretsmanager update-secret \
  --secret-id spirulina-gemini-api-key-prod \
  --secret-string '{"api-key":"YOUR_KEY"}'

# Cognito OAuth
aws secretsmanager update-secret \
  --secret-id spirulina-cognito-oauth-prod \
  --secret-string '{"client_secret":"YOUR_SECRET"}'
```

### Upload to Knowledge Base
```bash
KB_BUCKET=$(terraform output -raw agent_kb_bucket)
aws s3 cp ./docs/ s3://$KB_BUCKET/env/prod/ --recursive
```

### Sync Knowledge Base
```bash
KB_ID=$(terraform output -raw bedrock_kb_id)
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id $KB_ID \
  --data-source-id DATA_SOURCE_ID
```

### Test Endpoint
```bash
API_URL=$(terraform output -raw agent_api_base_url)
curl -X POST $API_URL/agent/generate \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image_key":"product.jpg","product_query":"Anti-aging cream"}'
```

## Outputs Reference

```bash
terraform output bedrock_kb_id                    # KB ID
terraform output agent_kb_bucket                  # KB S3 bucket
terraform output agent_images_input_bucket        # Input bucket
terraform output agent_images_output_bucket       # Output bucket
terraform output agent_jobs_queue_url             # SQS URL
terraform output agent_api_base_url               # API URL
terraform output set_agent_permission_lambda_arn  # Lambda ARN
terraform output get_agent_permission_lambda_arn  # Lambda ARN
terraform output agent_monitoring_api_lambda_arn  # Lambda ARN
terraform output agentic_flow_lambda_arn         # Lambda ARN
terraform output agent_worker_lambda_arn         # Lambda ARN
```

## CloudWatch Log Groups

```
/aws/lambda/spirulina-set-agent-permission-prod
/aws/lambda/spirulina-get-agent-permission-prod
/aws/lambda/spirulina-agent-monitoring-api-prod
/aws/lambda/spirulina-agentic-flow-prod
/aws/lambda/spirulina-agent-worker-prod
```

## Cost Breakdown (Monthly Estimate)

| Service | Cost |
|---------|------|
| OpenSearch Serverless | ~$700 |
| Lambda | ~$10-20 |
| S3 | ~$5-10 |
| DynamoDB | ~$1-5 |
| SQS | ~$0.40 |
| Secrets Manager | ~$1 |
| Bedrock (usage-based) | Variable |
| **Total** | **~$720-750** |

## Security Checklist

- [ ] Update Gemini API key in Secrets Manager
- [ ] Update Cognito OAuth secret in Secrets Manager
- [ ] Verify RDS secret ARN is correct
- [ ] Confirm Lambda security groups allow RDS access
- [ ] Enable S3 bucket encryption
- [ ] Review IAM policies for least privilege
- [ ] Enable CloudWatch alarms
- [ ] Configure WAF rules for API Gateway
- [ ] Rotate secrets regularly
- [ ] Enable MFA for AWS console access

## Common Issues & Solutions

### "Knowledge Base returns no results"
- Verify ingestion job completed: `aws bedrock-agent list-ingestion-jobs --knowledge-base-id KB_ID`
- Check documents are in S3: `aws s3 ls s3://BUCKET/env/prod/`
- Ensure OpenSearch collection is active

### "Lambda timeout"
- Increase timeout in `agent_lambdas.tf`
- Check CloudWatch Logs for specific errors
- Verify external API calls (Gemini) are responding

### "Permission denied accessing RDS"
- Verify Lambda is in correct VPC subnets
- Check security group allows Lambda → RDS traffic
- Confirm RDS secret has correct credentials

### "API Gateway 403 error"
- Verify JWT token is valid
- Check Cognito authorizer configuration
- Ensure user has required permissions in database

## Next Steps After Deployment

1. Upload brand documents to KB S3 bucket
2. Trigger ingestion job to populate vector index
3. Upload product images to input bucket
4. Update secrets with real API keys
5. Test each endpoint individually
6. Set up CloudWatch dashboards and alarms
7. Configure auto-scaling for Lambda (if needed)
8. Document API usage for frontend team
9. Set up CI/CD pipeline for lambda updates
10. Plan regular backups of S3 data

## Reference Links

- **Bedrock KB**: [bedrock_agent.tf:89](bedrock_agent.tf#L89)
- **Lambda Functions**: [agent_lambdas.tf](agent_lambdas.tf)
- **API Routes**: [agent_api_routes.tf](agent_api_routes.tf)
- **Full Guide**: [AGENT_DEPLOYMENT_GUIDE.md](AGENT_DEPLOYMENT_GUIDE.md)
