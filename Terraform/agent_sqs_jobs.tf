# This file defines the SQS queue used by the Agent Monitoring API 
# (Required by agent_monitoring_api and agent-worker Lambdas)

resource "aws_sqs_queue" "agent_job_queue" {
  name                       = "${var.project}-${var.env}-agent-jobs-queue"
  delay_seconds              = 0
  max_message_size           = 262144  # 256 KB
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300     # 5 minutes (Must be longer than Lambda timeout)

  tags = {
    Name        = "Agent Job Queue"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_sqs_queue" "agent_job_dlq" {
  name = "${var.project}-${var.env}-agent-jobs-dlq"

  tags = {
    Name        = "Agent Job DLQ"
    Environment = var.env
    Project     = var.project
  }
}

resource "aws_sqs_queue_redrive_policy" "agent_job_redrive" {
  queue_url = aws_sqs_queue.agent_job_queue.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.agent_job_dlq.arn
    maxReceiveCount     = 3
  })
}

output "agent_jobs_queue_url" {
  description = "The URL of the SQS Queue for agent job requests."
  value       = aws_sqs_queue.agent_job_queue.id
}
