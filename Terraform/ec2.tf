# Key pair for EC2 login (uses your provided public key)
resource "aws_key_pair" "bastion" {
  key_name   = "${var.project}-bastion-key"
  public_key = var.ssh_public_key
}

# If you have explicit subnets public_a / public_b, just pick one:
locals {
  bastion_public_subnet_id = aws_subnet.public_a.id
}

# Amazon Linux 2023 AMI
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-6.1-*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_instance" "bastion" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = "t3.micro"
  subnet_id                   = local.bastion_public_subnet_id
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  key_name                    = aws_key_pair.bastion.key_name
  associate_public_ip_address = true

  user_data = <<-BASH
    #!/bin/bash
    dnf -y update
    dnf -y install mysql
  BASH

  tags = { Name = "${var.project}-bastion" }
}

output "bastion_public_ip" { value = aws_instance.bastion.public_ip }
output "bastion_public_dns" { value = aws_instance.bastion.public_dns }
