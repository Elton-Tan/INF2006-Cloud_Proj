########################
# Auto Scaling Group
########################
resource "aws_autoscaling_group" "app" {
  name                      = "${var.project}-${var.env}-asg"
  vpc_zone_identifier       = local.asg_subnets
  min_size                  = 2
  max_size                  = 4
  desired_capacity          = 2
  health_check_type         = "ELB"
  health_check_grace_period = 120
  capacity_rebalance        = true

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  # Register instances into the TG we create above
  target_group_arns = [aws_lb_target_group.app.arn]

  lifecycle {
    create_before_destroy = true
  }

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

  depends_on = [aws_lb_listener.http]
}

########################
# Example scaling policies
########################

# CPU target tracking
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

# ALB RequestCountPerTarget target tracking
resource "aws_autoscaling_policy" "tt_alb_rps" {
  name                   = "${var.project}-${var.env}-tt-alb-rps"
  policy_type            = "TargetTrackingScaling"
  autoscaling_group_name = aws_autoscaling_group.app.name

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      # Format must be "<lb arn_suffix>/<tg arn_suffix>"
      resource_label = "${aws_lb.app.arn_suffix}/${aws_lb_target_group.app.arn_suffix}"
    }
    target_value = 100
  }
}

# Optional simple alarm (scale-out hint), harmless to keep
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