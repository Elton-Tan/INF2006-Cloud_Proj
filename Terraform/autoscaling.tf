############################################
# Subnets to place ASG instances
############################################
locals {
  asg_subnets_map = {
    private = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    public  = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  }
  asg_subnets = local.asg_subnets_map[var.app_subnets_to_use]
}

############################################
# Look up your existing ALB & Target Group
############################################
data "aws_lb" "by_name" {
  name = var.existing_alb_name
}

data "aws_lb_target_group" "by_name" {
  name = var.existing_tg_name
}

############################################
# Launch Template for app instances
# (reuses data.aws_ami.al2023 from ec2.tf)
############################################
resource "aws_launch_template" "app" {
  name_prefix   = "${var.project}-${var.env}-app-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.app_instance_type

  network_interfaces {
    associate_public_ip_address = var.app_subnets_to_use == "public" ? true : false
    security_groups             = [aws_security_group.app.id]
  }

  key_name = var.bastion_key_name

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
    tags          = { Name = "${var.project}-${var.env}-app" }
  }
}

############################################
# Auto Scaling Group (registers to existing TG)
############################################
resource "aws_autoscaling_group" "app" {
  name                      = "${var.project}-${var.env}-asg"
  min_size                  = var.app_min_size
  max_size                  = var.app_max_size
  desired_capacity          = var.app_desired_capacity
  vpc_zone_identifier       = local.asg_subnets
  health_check_type         = "ELB"
  health_check_grace_period = 90
  capacity_rebalance        = true

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  target_group_arns = [data.aws_lb_target_group.by_name.arn]

  lifecycle { create_before_destroy = true }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 75
      instance_warmup        = 60
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.project}-${var.env}-app"
    propagate_at_launch = true
  }
}

############################################
# Target tracking scaling policies
############################################

resource "aws_autoscaling_policy" "tt_cpu" {
  name                   = "${var.project}-${var.env}-tt-cpu"
  policy_type            = "TargetTrackingScaling"
  autoscaling_group_name = aws_autoscaling_group.app.name
  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 40
  }
}

resource "aws_autoscaling_policy" "tt_alb_rps" {
  name                   = "${var.project}-${var.env}-tt-alb-rps"
  policy_type            = "TargetTrackingScaling"
  autoscaling_group_name = aws_autoscaling_group.app.name
  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${data.aws_lb.by_name.arn_suffix}/${data.aws_lb_target_group.by_name.arn_suffix}"
    }
    target_value = 100
  }
}
