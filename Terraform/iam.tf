# Use the pre-provisioned role
data "aws_iam_role" "labrole" {
  name = "LabRole"
}
