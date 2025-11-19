# Terraform Files Review Checklist

## Step-by-Step Review Process

### Step 1: Variable Naming Consistency ⚠️

**Issue Found**: Your existing Terraform uses different variable names than the new agent files!

**Existing variables.tf uses:**
- `project` (not `project_name`)
- `env` (not `environment`)

**Action Required:**
Update the new agent Terraform files to match your existing naming convention.

#### Files to update:
- [ ] `bedrock_agent.tf` - Replace all `var.project_name` with `var.project`
- [ ] `bedrock_agent.tf` - Replace all `var.environment` with `var.env`
- [ ] `agent_lambdas.tf` - Replace all `var.project_name` with `var.project`
- [ ] `agent_lambdas.tf` - Replace all `var.environment` with `var.env`
- [ ] `agent_api_routes.tf` - Replace all `var.environment` with `var.env`

---

### Step 2: Add Missing Variables to terraform.tfvars

You need to add these new variables to your `terraform.tfvars` file:

```hcl
# Add these to terraform.tfvars:

# RDS Secret ARN - Get this from AWS Console or CLI
rds_secret_arn = "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:spirulina-rds-secret-XXXXX"

# Private Subnets - You have these defined, need to reference them
private_subnet_ids = [
  # These are created by your network.tf
  # You'll need to get these from terraform output or AWS console
  "subnet-xxxxx",  # private_subnet_a
  "subnet-yyyyy"   # private_subnet_b
]

# Lambda Security Group IDs
lambda_security_group_ids = [
  # This should be a security group that allows:
  # - Outbound to RDS (port 3306)
  # - Outbound to internet for AWS services
  "sg-xxxxx"
]
```

**How to get these values:**

```bash
# Get RDS Secret ARN
aws secretsmanager list-secrets --region us-east-1 | grep -A 5 "spirulina"

# Get Subnet IDs (from your existing Terraform)
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform
terraform output | grep subnet

# Get Security Group IDs
aws ec2 describe-security-groups --region us-east-1 --filters "Name=tag:Name,Values=*lambda*"
```

---

### Step 3: Check for Existing Resources

Before applying, verify these resources **DO NOT** already exist in AWS:

```bash
# Check for existing Bedrock Knowledge Bases
aws bedrock-agent list-knowledge-bases --region us-east-1

# Check for existing OpenSearch Serverless collections
aws opensearchserverless list-collections --region us-east-1

# Check for existing Lambda functions
aws lambda list-functions --region us-east-1 | grep -E "(agent|bedrock)"

# Check for existing S3 buckets
aws s3 ls | grep -E "(agent|kb|knowledge)"

# Check for existing DynamoDB tables
aws dynamodb list-tables --region us-east-1 | grep -i agent

# Check for existing SQS queues
aws sqs list-queues --region us-east-1 | grep -i agent
```

**Expected Result**: If the resources already exist, you'll need to either:
1. Import them into Terraform state (`terraform import`)
2. Or rename resources in the `.tf` files to avoid conflicts

---

### Step 4: Fix API Gateway References

**Issue**: The new agent files reference API Gateways that may not exist in your Terraform state.

Check if these resources exist in your existing Terraform:

```bash
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform
grep -r "aws_apigatewayv2_api" *.tf
grep -r "aws_apigatewayv2_authorizer" *.tf
```

#### Check your apigw_http.tf:

- [ ] Does `aws_apigatewayv2_api.http` exist?
- [ ] Does `aws_apigatewayv2_authorizer.cognito` exist?
- [ ] Does `aws_apigatewayv2_api.websocket` exist?

If **NO**, you need to update `agent_api_routes.tf` and `agent_lambdas.tf` to reference the correct API Gateway resource names.

---

### Step 5: Verify Lambda Layer References

Check if the MySQL layer exists:

```bash
# List your Lambda layers
aws lambda list-layers --region us-east-1

# Check if spirulina-MySQL layer exists
aws lambda list-layer-versions --layer-name spirulina-MySQL --region us-east-1
```

If the layer doesn't exist, you need to:
- [ ] Create the layer first, OR
- [ ] Update `agent_lambdas.tf` to use the correct layer name/ARN

---

### Step 6: Validate Terraform Syntax

```bash
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform

# Format the files
terraform fmt

# Validate syntax
terraform validate
```

Fix any syntax errors reported.

---

### Step 7: Run Terraform Plan (Dry Run)

**IMPORTANT**: This will NOT deploy anything, just show what would happen.

```bash
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform

# Initialize (downloads providers for new resources)
terraform init

# Create a plan
terraform plan -out=review.tfplan
```

**What to look for in the output:**

✅ **GOOD SIGNS:**
- `Plan: X to add, 0 to change, 0 to destroy`
- Only NEW resources being created
- No existing resources being replaced or destroyed

❌ **WARNING SIGNS:**
- `Plan: X to add, Y to change, Z to destroy`
- Any resource showing `~ update in-place` or `+/- create replacement`
- Destroying existing lambdas, databases, or API gateways
- Changes to existing S3 buckets or DynamoDB tables

If you see any warning signs, **STOP** and review what's changing!

---

### Step 8: Review Specific Resource Configurations

#### 8.1 Check S3 Bucket Names

Look at `bedrock_agent.tf` lines 14-50:

```hcl
bucket = "${var.project}-agent-kb-${var.env}"
```

With your values (`project = "spirulina"`, `env = "dev"`), this becomes:
- `spirulina-agent-kb-dev`
- `spirulina-agent-images-input-dev`
- `spirulina-agent-images-output-dev`

**Verify these don't conflict with existing buckets:**

```bash
aws s3 ls | grep spirulina
```

#### 8.2 Check Lambda Function Names

With your values, Lambda functions will be named:
- `spirulina-set-agent-permission-dev`
- `spirulina-get-agent-permission-dev`
- `spirulina-agent-monitoring-api-dev`
- `spirulina-agentic-flow-dev`
- `spirulina-agent-worker-dev`

**Verify these don't exist:**

```bash
aws lambda list-functions --region us-east-1 | grep "spirulina-.*agent"
```

#### 8.3 Check DynamoDB Table Name

The table will be named: `AgentJobs`

**Verify it doesn't exist:**

```bash
aws dynamodb describe-table --table-name AgentJobs --region us-east-1 2>&1
```

If it says "Table not found" = Good! ✅
If it shows table details = Already exists! ⚠️

#### 8.4 Check SQS Queue Names

Queues will be named:
- `spirulina-agent-jobs-dev`
- `spirulina-agent-jobs-dlq-dev`

**Verify:**

```bash
aws sqs list-queues --region us-east-1 | grep agent
```

---

### Step 9: Check IAM Permissions

Verify your AWS credentials have permissions to create:
- [ ] Bedrock resources
- [ ] OpenSearch Serverless
- [ ] Lambda functions
- [ ] S3 buckets
- [ ] DynamoDB tables
- [ ] SQS queues
- [ ] Secrets Manager secrets
- [ ] IAM roles and policies

Test with:

```bash
# Check current identity
aws sts get-caller-identity

# Try to list Bedrock KBs (tests Bedrock permissions)
aws bedrock-agent list-knowledge-bases --region us-east-1
```

---

### Step 10: Review Cost Implications

Before deploying, understand the costs:

**OpenSearch Serverless** (BIGGEST cost):
- ~$700/month for 2 OCU minimum
- This is the vector database for Bedrock KB

**Alternative**: If cost is a concern, you could use:
- Amazon Aurora with pgvector (~$50-100/month)
- Amazon Kendra (~$800/month but includes more features)

**Question for your team**: Is the ~$700/month for OpenSearch Serverless approved?

---

### Step 11: Code Review Checklist

Review each file manually:

#### bedrock_agent.tf
- [ ] Line 14-50: S3 bucket names are correct
- [ ] Line 62-87: IAM role has correct permissions
- [ ] Line 95: Bedrock KB uses correct embedding model (`amazon.titan-embed-text-v2:0`) ✅
- [ ] Line 103-105: Vector configuration is correct
- [ ] Line 107-121: OpenSearch Serverless configuration looks good
- [ ] Line 171-178: Data source points to correct S3 bucket
- [ ] Line 195-215: DynamoDB table schema is correct
- [ ] Line 219-244: SQS queue configuration looks good
- [ ] Line 248-272: Secrets Manager placeholders are noted

#### agent_lambdas.tf
- [ ] Line 47-66: IAM role permissions cover all needed services
- [ ] Line 127: MySQL layer reference exists
- [ ] Line 134-168: set-agent-permission has correct env vars
- [ ] Line 180-214: get-agent-permission has correct env vars
- [ ] Line 226-254: agent_monitoring_api has correct env vars
- [ ] Line 266-297: agentic-flow has correct env vars (matches handler.py)
- [ ] Line 309-344: agent_worker has correct env vars
- [ ] Line 350-355: SQS trigger configuration is correct

#### agent_api_routes.tf
- [ ] Line 12-29: GET /agent/permission route
- [ ] Line 31-48: POST /agent/permission route
- [ ] Line 50-67: POST /agent/monitoring/start route
- [ ] Line 69-83: GET /agent/status route
- [ ] Line 87-104: POST /agent/generate route (optional)
- [ ] All routes use Cognito authorizer (line 18, 39, 58, 75, 95)

---

### Step 12: Test Plan After Review

Once files are reviewed and updated:

1. **Update variables** (Step 2)
2. **Run terraform plan** (Step 7)
3. **Review plan output** carefully
4. **If plan looks good**, save it: `terraform plan -out=agent.tfplan`
5. **Share plan with team** for approval
6. **When approved**, apply: `terraform apply agent.tfplan`
7. **Verify deployment** with AWS CLI commands
8. **Update secrets** with real API keys
9. **Upload KB data** to S3
10. **Test endpoints** with curl

---

## Quick Commands Reference

```bash
# Navigate to Terraform directory
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform

# Get RDS secret ARN
aws secretsmanager list-secrets --region us-east-1 --query "SecretList[?contains(Name, 'rds') || contains(Name, 'spirulina')].ARN" --output table

# Get subnet IDs from existing resources
aws ec2 describe-subnets --region us-east-1 --filters "Name=tag:Name,Values=*private*" --query "Subnets[].SubnetId" --output table

# Get security group IDs
aws ec2 describe-security-groups --region us-east-1 --filters "Name=tag:Name,Values=*lambda*" --query "SecurityGroups[].GroupId" --output table

# Check what Terraform knows about
terraform state list

# Format all files
terraform fmt

# Validate syntax
terraform validate

# Create plan
terraform plan -out=review.tfplan

# Review plan (don't apply yet!)
terraform show review.tfplan
```

---

## Summary

### Critical Issues to Fix:
1. ⚠️ **Variable names**: Change `project_name` → `project`, `environment` → `env`
2. ⚠️ **Add variables** to `terraform.tfvars`: `rds_secret_arn`, `private_subnet_ids`, `lambda_security_group_ids`
3. ⚠️ **Verify API Gateway** resource names match existing infrastructure
4. ⚠️ **Check for resource conflicts** - make sure nothing already exists

### After Fixing:
1. ✅ Run `terraform plan`
2. ✅ Review the plan output carefully
3. ✅ Check for any unexpected changes or deletions
4. ✅ Get team approval before applying
5. ✅ Document any deviations from the plan

---

## Need Help?

If you see errors during review:
1. Note the exact error message
2. Check which file and line number
3. Look up the resource in AWS console to see current state
4. Ask for help with specific error details
