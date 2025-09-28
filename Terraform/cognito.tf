# ============ Cognito User Pool ============
resource "aws_cognito_user_pool" "main" {
  name                = "${var.project}-user-pool"
  deletion_protection = "INACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # Optional: make self-signup easy during dev
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 5
      max_length = 2048
    }
  }
}

# Hosted UI domain (uses AWS-managed cognito domain)
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project}-${var.env}-auth" # must be globally unique
  user_pool_id = aws_cognito_user_pool.main.id
}

# ============ App Client (Hosted UI + Implicit flow for tokens in URL) ============
resource "aws_cognito_user_pool_client" "spa" {
  name            = "${var.project}-spa"
  user_pool_id    = aws_cognito_user_pool.main.id
  generate_secret = false

  supported_identity_providers = ["COGNITO"]

  # You want the tokens right in the URL after login:
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["implicit"]
  allowed_oauth_scopes                 = ["openid", "email", "phone"]

  # Your SPA origins (CloudFront + localhost for dev)
  callback_urls = [
    var.cloudfront_url, # e.g. https://d84l1y8p4kdic.cloudfront.net/
    "http://localhost:5173/"
  ]
  logout_urls = [
    var.cloudfront_url,
    "http://localhost:5173/"
  ]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
}

# Helpful outputs
output "cognito_login_url" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com/login?client_id=${aws_cognito_user_pool_client.spa.id}&response_type=token&scope=openid+email+phone&redirect_uri=${urlencode(var.cloudfront_url)}"
}

output "cognito_issuer" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}
