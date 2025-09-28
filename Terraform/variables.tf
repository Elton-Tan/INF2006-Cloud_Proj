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
