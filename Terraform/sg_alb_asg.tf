############################################
# Security Groups for ALB and App instances
############################################

resource "aws_security_group" "alb" {
  name        = "${var.project}-${var.env}-alb-sg"
  description = "ALB ingress from internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-${var.env}-alb-sg" }
}

resource "aws_security_group" "app" {
  name        = "${var.project}-${var.env}-app-sg"
  description = "App instances behind ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Traffic from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Optional: SSH only from your bastion SG (uncomment if you have one)
  # ingress {
  #   description     = "SSH from bastion"
  #   from_port       = 22
  #   to_port         = 22
  #   protocol        = "tcp"
  #   security_groups = [aws_security_group.bastion.id]
  # }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-${var.env}-app-sg" }
}
