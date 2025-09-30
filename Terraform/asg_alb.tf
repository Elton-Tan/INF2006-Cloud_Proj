############################################
# ALB + Target Group + Auto Scaling (2 AZs)
############################################

# Use public subnets for the ALB, and place instances in private (preferred).
# If you don't have NAT yet, temporarily place instances in public by setting var.app_subnets_to_use = "public".

########################
# Inputs (vars you have)
########################
# variable "project"            { type = string }                # e.g., "spirulina"
# variable "env"                { type = string }                # e.g., "dev"
# variable "app_instance_type"  { type = string  default = "t3.micro" }
# variable "bastion_key_name"   { type = string  default = null } # set if you really need SSH
# variable "app_health_check_path" { type = string default = "/" }

########################
# Choose subnets for ASG
########################
variable "app_subnets_to_use" {
  type    = string
  default = "private"
  validation {
    condition     = contains(["private", "public"], var.app_subnets_to_use)
    error_message = "app_subnets_to_use must be 'private' or 'public'."
  }
}

locals {
  # ALB in public subnets (A/B)
  alb_subnets = [
    aws_subnet.public_a.id,
    aws_subnet.public_b.id
  ]

  # Map for where instances live
  app_instance_subnets_map = {
    private = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    public  = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  }
  asg_subnets = local.app_instance_subnets_map[var.app_subnets_to_use]
}

########################
# Load Balancer + TG
########################
resource "aws_lb" "app" {
  name               = "${var.project}-${var.env}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.alb_subnets
  idle_timeout       = 60

  tags = {
    Name    = "${var.project}-${var.env}-alb"
    Project = var.project
    Env     = var.env
  }
}

resource "aws_lb_target_group" "app" {
  name        = "${var.project}-${var.env}-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    enabled             = true
    path                = var.app_health_check_path
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  tags = {
    Name    = "${var.project}-${var.env}-tg"
    Project = var.project
    Env     = var.env
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

########################
# Launch Template
########################
# Uses your existing AL2023 data source. If named differently, change here.
# Example of what you likely have in ec2.tf:
# data "aws_ami" "al2023" {
#   most_recent = true
#   owners      = ["amazon"]
#   filter { name="name"; values=["al2023-ami-*-x86_64"] }
# }

resource "aws_launch_template" "app" {
  name_prefix   = "${var.project}-${var.env}-app-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.app_instance_type

  # If instances are in public subnets, let them have public IPs. Otherwise false.
  network_interfaces {
    associate_public_ip_address = var.app_subnets_to_use == "public"
    security_groups             = [aws_security_group.app.id]
  }

  key_name = var.bastion_key_name # null is okay if you use SSM and not SSH

  user_data = base64encode(<<-BASH
    #!/bin/bash
    dnf -y update
    dnf -y install nginx
    echo "<h1>${var.project} ${var.env} app server</h1>" > /usr/share/nginx/html/index.html
    systemctl enable --now nginx
  BASH
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = "${var.project}-${var.env}-app"
      Project = var.project
      Env     = var.env
    }
  }
}