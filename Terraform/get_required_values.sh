#!/bin/bash
# Script to get required values for agent infrastructure deployment

echo "============================================"
echo "Getting Required Values for Agent Terraform"
echo "============================================"
echo ""

REGION="us-east-1"

echo "1. RDS Secret ARN:"
echo "-------------------"
aws secretsmanager list-secrets --region $REGION \
  --query "SecretList[?contains(Name, 'rds') || contains(Name, 'spirulina') || contains(Name, 'mysql')].{Name:Name, ARN:ARN}" \
  --output table
echo ""
echo "Copy the ARN from above and add to terraform.tfvars as:"
echo 'rds_secret_arn = "arn:aws:secretsmanager:..."'
echo ""
echo ""

echo "2. Private Subnet IDs (for Lambda VPC access):"
echo "-----------------------------------------------"
aws ec2 describe-subnets --region $REGION \
  --filters "Name=tag:Name,Values=*private*" "Name=tag:Project,Values=spirulina" \
  --query "Subnets[].{Name:Tags[?Key=='Name']|[0].Value, SubnetId:SubnetId, CIDR:CidrBlock, AZ:AvailabilityZone}" \
  --output table 2>/dev/null

if [ $? -ne 0 ]; then
  echo "Trying alternative filter..."
  aws ec2 describe-subnets --region $REGION \
    --filters "Name=cidr-block,Values=10.20.11.0/24,10.20.12.0/24" \
    --query "Subnets[].{SubnetId:SubnetId, CIDR:CidrBlock, AZ:AvailabilityZone}" \
    --output table
fi

echo ""
echo "Copy the Subnet IDs from above and add to terraform.tfvars as:"
echo 'private_subnet_ids = ["subnet-xxx", "subnet-yyy"]'
echo ""
echo ""

echo "3. Lambda Security Groups:"
echo "--------------------------"
aws ec2 describe-security-groups --region $REGION \
  --filters "Name=tag:Project,Values=spirulina" \
  --query "SecurityGroups[].{Name:GroupName, GroupId:GroupId, Description:Description}" \
  --output table 2>/dev/null

if [ $? -ne 0 ]; then
  echo "Trying VPC-based search..."
  VPC_ID=$(aws ec2 describe-vpcs --region $REGION --filters "Name=tag:Project,Values=spirulina" --query "Vpcs[0].VpcId" --output text)
  if [ "$VPC_ID" != "None" ] && [ -n "$VPC_ID" ]; then
    aws ec2 describe-security-groups --region $REGION \
      --filters "Name=vpc-id,Values=$VPC_ID" \
      --query "SecurityGroups[].{Name:GroupName, GroupId:GroupId, Description:Description}" \
      --output table
  fi
fi

echo ""
echo "Look for a security group that allows outbound to RDS."
echo "Add to terraform.tfvars as:"
echo 'lambda_security_group_ids = ["sg-xxx"]'
echo ""
echo ""

echo "4. Current terraform.tfvars (for reference):"
echo "---------------------------------------------"
if [ -f terraform.tfvars ]; then
  echo "Your current terraform.tfvars contains:"
  cat terraform.tfvars | grep -E "(region|env|project)" | head -5
else
  echo "terraform.tfvars not found in current directory"
fi
echo ""
echo ""

echo "============================================"
echo "Next Steps:"
echo "============================================"
echo "1. Add the 3 values above to terraform.tfvars"
echo "2. Run: terraform init"
echo "3. Run: terraform validate"
echo "4. Run: terraform plan -out=agent.tfplan"
echo "5. Review the plan carefully"
echo "6. If it looks good, run: terraform apply agent.tfplan"
echo ""
echo "See REVIEW_CHECKLIST.md for detailed review steps"
echo "============================================"
