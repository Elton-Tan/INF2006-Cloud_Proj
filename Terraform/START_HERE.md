# START HERE - Agent Infrastructure Review Guide

## What Was Created

I've created Terraform configuration for your Bedrock-powered agent infrastructure:

### ✅ Fixed Issues
- Variable naming now matches your existing setup (`var.project`, `var.env`)
- All files use consistent naming conventions
- Ready to integrate with your existing Terraform

### 📁 Files Created

1. **bedrock_agent.tf** - Bedrock KB, S3, OpenSearch, DynamoDB, SQS, Secrets
2. **agent_lambdas.tf** - 5 Lambda functions with IAM roles
3. **agent_api_routes.tf** - API Gateway integrations
4. **agent_variables.tf** - Variable definitions
5. **AGENT_DEPLOYMENT_GUIDE.md** - Comprehensive guide
6. **AGENT_QUICK_REFERENCE.md** - Quick reference
7. **REVIEW_CHECKLIST.md** - Detailed review checklist ⭐
8. **get_required_values.sh** - Helper script to get AWS values
9. **START_HERE.md** - This file

---

## 🚀 Quick Start (3 Steps)

### Step 1: Get Required Values

Run the helper script:

```bash
cd /Users/elliejosephalim/INF2006-Cloud_Proj/Terraform
./get_required_values.sh
```

This will show you:
- RDS Secret ARN
- Private Subnet IDs
- Security Group IDs

### Step 2: Add Values to terraform.tfvars

Add these 3 lines to your `terraform.tfvars`:

```hcl
# Values from get_required_values.sh script:
rds_secret_arn = "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT:secret:YOUR_SECRET"
private_subnet_ids = ["subnet-xxx", "subnet-yyy"]
lambda_security_group_ids = ["sg-xxx"]
```

### Step 3: Review and Plan

```bash
# Initialize Terraform (downloads new providers)
terraform init

# Validate syntax
terraform validate

# Create plan (DO NOT APPLY YET!)
terraform plan -out=agent.tfplan

# Review what will be created
terraform show agent.tfplan
```

**⚠️ IMPORTANT**: Review the plan output carefully! Make sure it's only creating NEW resources, not modifying or deleting existing ones.

---

## 📋 What to Review

### Critical Check: Ensure Plan Shows ONLY Additions

When you run `terraform plan`, you should see:

```
Plan: X to add, 0 to change, 0 to destroy
```

✅ **GOOD**: Only additions
❌ **BAD**: Any changes or destroys

If you see changes/destroys, **STOP** and check [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

### Resources That Will Be Created

With your values (`project = "spirulina"`, `env = "dev"`):

**S3 Buckets:**
- `spirulina-agent-kb-dev`
- `spirulina-agent-images-input-dev`
- `spirulina-agent-images-output-dev`

**Lambda Functions:**
- `spirulina-set-agent-permission-dev`
- `spirulina-get-agent-permission-dev`
- `spirulina-agent-monitoring-api-dev`
- `spirulina-agentic-flow-dev`
- `spirulina-agent-worker-dev`

**DynamoDB Table:**
- `AgentJobs`

**SQS Queues:**
- `spirulina-agent-jobs-dev`
- `spirulina-agent-jobs-dlq-dev`

**Bedrock Knowledge Base:**
- `spirulina-agent-kb-dev`
- Embedding Model: **Titan Embedding V2** ✅
- Vector Store: **OpenSearch Serverless** ✅

**Secrets Manager:**
- `spirulina-gemini-api-key-dev`
- `spirulina-cognito-oauth-dev`

**API Gateway Routes:**
- `GET /agent/permission`
- `POST /agent/permission`
- `POST /agent/monitoring/start`
- `GET /agent/status`
- `POST /agent/generate`

---

## ⚠️ Before You Deploy

### 1. Check for Existing Resources

Make sure these don't already exist:

```bash
# Check Bedrock KBs
aws bedrock-agent list-knowledge-bases --region us-east-1

# Check Lambda functions
aws lambda list-functions --region us-east-1 | grep agent

# Check S3 buckets
aws s3 ls | grep agent

# Check DynamoDB tables
aws dynamodb list-tables --region us-east-1 | grep -i agent
```

If any of these already exist, you need to either:
- Import them into Terraform state
- Rename resources in the .tf files

### 2. Understand the Costs

**Monthly estimate: ~$720-750**

Main cost driver:
- OpenSearch Serverless: ~$700/month (2 OCU minimum)

Other costs:
- Lambda, S3, DynamoDB, SQS: ~$20-50/month combined

**⚠️ Make sure this is approved by your team!**

### 3. Verify Permissions

Your AWS account needs permissions for:
- Bedrock (Knowledge Base, Model invocation)
- OpenSearch Serverless
- Lambda
- S3
- DynamoDB
- SQS
- Secrets Manager
- IAM role creation

---

## 📖 Detailed Documentation

For more information, see:

- **[REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)** - Step-by-step review process ⭐ **START HERE**
- **[AGENT_DEPLOYMENT_GUIDE.md](AGENT_DEPLOYMENT_GUIDE.md)** - Complete deployment guide
- **[AGENT_QUICK_REFERENCE.md](AGENT_QUICK_REFERENCE.md)** - Quick reference for common tasks

---

## 🔧 Common Issues

### "Variable not defined"
- Make sure you added the 3 new variables to `terraform.tfvars`
- Check that `agent_variables.tf` exists in the Terraform directory

### "Resource already exists"
- Check if resources are already deployed in AWS
- You may need to import existing resources or rename in .tf files

### API Gateway reference not found
- Your existing `apigw_http.tf` might use different resource names
- Check with: `grep "aws_apigatewayv2_api" apigw_http.tf`

### Lambda layer not found
- MySQL layer (`spirulina-MySQL`) must exist first
- Check with: `aws lambda list-layers --region us-east-1`

---

## 📞 Need Help?

1. **Review REVIEW_CHECKLIST.md** - Most common issues are covered there
2. **Check terraform plan output** - It will tell you what's wrong
3. **Look at CloudWatch Logs** - After deployment, check logs for errors
4. **Ask your team** - Especially about cost approval (~$700/month)

---

## ✅ Next Steps

1. [ ] Run `./get_required_values.sh`
2. [ ] Add 3 values to `terraform.tfvars`
3. [ ] Run `terraform init`
4. [ ] Run `terraform validate`
5. [ ] Run `terraform plan -out=agent.tfplan`
6. [ ] **Review the plan carefully** (see [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md))
7. [ ] Get team approval for ~$700/month cost
8. [ ] **When ready**: `terraform apply agent.tfplan`
9. [ ] Update secrets with real API keys
10. [ ] Upload knowledge base data to S3
11. [ ] Test endpoints

---

## 🎯 Quick Commands

```bash
# Get values you need
./get_required_values.sh

# Review checklist
open REVIEW_CHECKLIST.md

# Initialize
terraform init

# Validate
terraform validate

# Plan (don't apply yet!)
terraform plan -out=agent.tfplan

# Review plan
terraform show agent.tfplan | less

# When ready to deploy
terraform apply agent.tfplan
```

---

**Remember**: DO NOT run `terraform apply` until you've:
1. ✅ Reviewed the plan
2. ✅ Confirmed no existing resources will be destroyed
3. ✅ Got approval for the costs
4. ✅ Verified all values are correct

**The infrastructure is already deployed on AWS. These files are for documentation and future updates.**
