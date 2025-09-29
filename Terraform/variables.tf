variable "project" {
  type = string
}
variable "env" {
  type = string
}
variable "region" {
  type = string
}
variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
variable "public_subnet_a_cidr" {
  type    = string
  default = "10.20.1.0/24"
}
variable "public_subnet_b_cidr" {
  type    = string
  default = "10.20.2.0/24"
}
variable "private_subnet_a_cidr" {
  type    = string
  default = "10.20.11.0/24"
}
variable "private_subnet_b_cidr" {
  type    = string
  default = "10.20.12.0/24"
}
variable "cloudfront_url" {
  type = string
} # e.g. "https://d84l1y8p4kdic.cloudfront.net/"
variable "ssh_public_key" {
  description = "Your SSH public key for the bastion (contents of id_rsa.pub or ed25519.pub)"
  type        = string
}

variable "db_name" {
  description = "Initial database name for RDS"
  type        = string
}

variable "db_username" {
  description = "Master username for RDS"
  type        = string
}

variable "scrapingbee_secret_value" {
  description = "ScrapingBee (or scraper) API key value to store in Secrets Manager"
  type        = string
  sensitive   = true
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the bastion (e.g., your IP/32)"
  type        = string
  default     = "0.0.0.0/0" # tighten this!
}

# ASG/ALB params
variable "app_instance_type" {
  description = "Instance type for app ASG"
  type        = string
  default     = "t3.micro"
}

variable "app_min_size" {
  type    = number
  default = 2
}

variable "app_max_size" {
  type    = number
  default = 4
}

variable "app_desired_capacity" {
  type    = number
  default = 2
}

variable "alb_target_response_p90_ms" {
  type    = number
  default = 1500
}

variable "cf_total_latency_p90_ms" {
  type    = number
  default = 1500
}

variable "api_latency_p95_ms" {
  type    = number
  default = 1200
}

variable "alb_5xx_threshold" {
  type    = number
  default = 10
}

variable "cf_5xx_rate_threshold" {
  type    = number
  default = 1
}

variable "api_5xx_threshold" {
  type    = number
  default = 5
}

variable "waf_blocked_threshold" {
  type    = number
  default = 200
}


variable "app_health_check_path" {
  description = "ALB target health check path"
  type        = string
  default     = "/"
}

variable "alert_emails" {
  description = "Emails to subscribe to alarm notifications"
  type        = list(string)
  default     = []
}

variable "existing_alb_name" {
  type    = string
  default = "spirulina-dev-alb"
}

variable "existing_tg_name" {
  type    = string
  default = "spirulina-dev-tg"
}

variable "bastion_key_name" {
  type    = string
  default = null
} 