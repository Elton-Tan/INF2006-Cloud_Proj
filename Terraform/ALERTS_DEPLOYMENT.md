# Alerts API Deployment Guide

## Overview
This guide documents the implementation of the alerts API endpoint that reads from the `spirulinadb.alerts` table.

## Implementation Summary

### 1. Lambda Function Created
- **Location**: `Terraform/alerts_read/handler.py`
- **Purpose**: Reads alerts from the `alerts` table in `spirulinadb`
- **Features**:
  - Supports `?limit=` query parameter (default 50, max 200)
  - Returns alerts ordered by timestamp (most recent first)
  - Returns data in format: `{"alerts": [...]}`

### 2. Terraform Configuration Updated

#### Files Modified:
1. **lambda_packages.tf**
   - Added `data "archive_file" "alerts_read_zip"` block
   - Added `aws_lambda_function.alerts_read` resource
   - Configuration:
     - Runtime: Python 3.12
     - Handler: `handler.lambda_handler`
     - Memory: 256 MB
     - Timeout: 10 seconds
     - Layer: `mysql_layer` (for pymysql)
     - VPC-enabled for RDS access

2. **apigw_http.tf**
   - Added `aws_apigatewayv2_integration.alerts_read` resource
   - Added `"GET /alerts"` to `protected_routes` (JWT-protected)
   - Added `alerts_read` to `lambda_permissions` for API Gateway invoke

## Deployment Steps

### Step 1: Deploy Terraform Changes
```bash
cd Terraform
terraform init
terraform plan -out=alerts.tfplan
terraform apply alerts.tfplan
```

### Step 2: Verify Lambda Function
After deployment, verify:
- Lambda function exists: `spirulina-prod-alerts-read`
- Has correct VPC configuration
- Has MySQL layer attached
- Environment variables are set correctly

### Step 3: Test API Endpoint
```bash
# Get your JWT token from the app
export TOKEN="your-jwt-token-here"
export API_BASE="https://your-api-id.execute-api.us-east-1.amazonaws.com"

# Test the endpoint
curl -H "Authorization: Bearer $TOKEN" "$API_BASE/alerts"

# Test with limit
curl -H "Authorization: Bearer $TOKEN" "$API_BASE/alerts?limit=10"
```

Expected response:
```json
{
  "alerts": [
    {
      "id": "alert-id",
      "ts": "2025-11-21T12:00:00Z",
      "title": "Alert Title",
      "description": "Alert description",
      "severity": "high",
      "market": "SG",
      "channel": "Shopee"
    }
  ]
}
```

### Step 4: Update Frontend
Once API is deployed and tested:
1. Open `src/views/LiveFeed.tsx`
2. Change line 642: `const ENABLE_MOCK_ALERTS = true;` to `false`
3. Test the frontend to ensure real-time alerts are displayed

## Database Schema

The Lambda expects the following table structure:

```sql
CREATE TABLE alerts (
  id VARCHAR(255) PRIMARY KEY,
  ts TIMESTAMP NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity ENUM('low', 'medium', 'high') NOT NULL,
  market VARCHAR(50),
  channel VARCHAR(100),
  INDEX idx_ts (ts DESC)
);
```

## Architecture Flow

Following the flow diagram:

```
Dashboard → API Gateway → Lambda (alerts_read) → RDS (spirulinadb.alerts)
```

1. **Dashboard** makes authenticated request to `GET /alerts`
2. **API Gateway** validates JWT token and forwards to Lambda
3. **Lambda** queries the `alerts` table via pymysql
4. **Response** flows back with JSON alert data

## WebSocket Real-Time Updates

The alerts are also pushed via WebSocket when new alerts are created:
- WebSocket message type: `alerts.created`
- Payload includes full alert object
- Frontend listens on `alerts:created` event bus

## Troubleshooting

### Lambda can't connect to RDS
- Verify Lambda is in correct VPC subnets
- Check security group allows Lambda → RDS connection
- Verify DB secret ARN is correct

### API returns 403
- Check JWT token is valid
- Verify API Gateway JWT authorizer is configured correctly
- Check Cognito user pool client ID matches

### Empty alerts array
- Verify `alerts` table exists in `spirulinadb`
- Check table has data
- Verify Lambda has SELECT permission on table

## Next Steps

After deployment:
1. Test the API endpoint
2. Disable mock mode in LiveFeed.tsx
3. Verify real-time alerts work end-to-end
4. Monitor CloudWatch logs for any errors
