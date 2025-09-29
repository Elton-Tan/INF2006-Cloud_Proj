############################################
# ALB + Target Group + Auto Scaling (2 AZs)
############################################

# Reuse your public subnets for ALB, and place instances in private (preferred)
# If you don't have NAT yet, you can temporarily use public subnets for instances by flipping var.app_subnets_to_use

locals {
  # ALB in public subnets (A/B)
  alb_subnets = [
    aws_subnet.public_a.id,
    aws_subnet.public_b.id
  ]

  # Instances in private by default, or public if you flip var.app_subnets_to_use
  app_instance_subnets_map = {
    private = [
      aws_subnet.private_a.id,
      aws_subnet.private_b.id
    ]
    public = [
      aws_subnet.public_a.id,
      aws_subnet.public_b.id
    ]
  }

  app_instance_subns = local.app_instance_subnets_map[var.app_subnets_to_use]
}



resource "aws_lb" "app" {
  name                       = "${var.project}-${var.env}-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = local.alb_subnets
  idle_timeout               = 60
  enable_deletion_protection = false

  tags = { Name = "${var.project}-${var.env}-alb" }
}

resource "aws_lb_target_group" "app" {
  name        = "${var.project}-${var.env}-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 5
    path                = var.app_health_check_path
    matcher             = "200-399"
  }

  tags = { Name = "${var.project}-${var.env}-tg" }
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

# AMI: reuse the AL2023 data source you already have in ec2.tf
# If that data source name differs, adjust here.
data "aws_ami" "al2023_for_asg" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}


# Scale on ALB request count per target (optional, simple policy)
resource "aws_cloudwatch_metric_alarm" "high_rps" {
  alarm_name          = "${var.project}-${var.env}-scale-out"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RequestCountPerTarget"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 100
  dimensions = {
    TargetGroup  = aws_lb_target_group.app.arn_suffix
    LoadBalancer = aws_lb.app.arn_suffix
  }
  alarm_description = "Scale out when ALB RPS per target > 100"
}

resource "aws_autoscaling_policy" "scale_out" {
  name                   = "${var.project}-${var.env}-scale-out"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "SimpleScaling"
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 1

  depends_on = [aws_cloudwatch_metric_alarm.high_rps]
}

# Look up existing ALB and Target Group by name
data "aws_lb" "existing_alb" {
  name = "spirulina-dev-alb"
}

data "aws_lb_target_group" "existing_tg" {
  name = "spirulina-dev-tg"
}


# Choose where ASG instances live (private preferred)
variable "app_subnets_to_use" {
  type    = string
  default = "private"

  validation {
    condition     = contains(["private", "public"], var.app_subnets_to_use)
    error_message = "app_subnets_to_use must be 'private' or 'public'."
  }
}


