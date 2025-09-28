############################
# Lambda packaging & funcs #
############################

locals {
  lambda_env = {
    REGION             = var.region
    CONN_TABLE         = aws_dynamodb_table.conns.name
    CONN_GSI           = "gsi_conn"
    TTL_DAYS           = "1"
    QUEUE_URL          = aws_sqs_queue.main.id
    DB_SECRET_ARN      = aws_secretsmanager_secret.db.arn
    SCRAPER_SECRET_ARN = aws_secretsmanager_secret.scraper.arn
  }
}

# Ensure you have a dist/ folder (create once: mkdir dist)

# --------- Zip each lambda FOLDER (handler.py inside) ----------
data "archive_file" "connect_zip" {
  type        = "zip"
  source_dir  = "${path.module}/connect"
  output_path = "${path.module}/dist/connect.zip"
}

data "archive_file" "disconnect_zip" {
  type        = "zip"
  source_dir  = "${path.module}/disconnect"
  output_path = "${path.module}/dist/disconnect.zip"
}

data "archive_file" "enqueue_zip" {
  type        = "zip"
  source_dir  = "${path.module}/enqueue"
  output_path = "${path.module}/dist/enqueue.zip"
}

data "archive_file" "worker_zip" {
  type        = "zip"
  source_dir  = "${path.module}/worker"
  output_path = "${path.module}/dist/worker.zip"
}

data "archive_file" "watchlist_zip" {
  type        = "zip"
  source_dir  = "${path.module}/watchlist"
  output_path = "${path.module}/dist/watchlist.zip"
}

# =========================
# Functions (Python 3.12)  #
# =========================

# CONNECT
resource "aws_lambda_function" "connect" {
  function_name = "${var.project}-${var.env}-connect"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.connect_zip.output_path
  timeout       = 10

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION     = var.region
      CONN_TABLE = local.lambda_env.CONN_TABLE
      TTL_DAYS   = local.lambda_env.TTL_DAYS
    }
  }
}

# DISCONNECT
resource "aws_lambda_function" "disconnect" {
  function_name = "${var.project}-${var.env}-disconnect"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.disconnect_zip.output_path
  timeout       = 10

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION     = var.region
      CONN_TABLE = local.lambda_env.CONN_TABLE
      CONN_GSI   = local.lambda_env.CONN_GSI
    }
  }
}

# ENQUEUE
resource "aws_lambda_function" "enqueue" {
  function_name = "${var.project}-${var.env}-enqueue"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.enqueue_zip.output_path
  timeout       = 10

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION    = var.region
      QUEUE_URL = local.lambda_env.QUEUE_URL
    }
  }
}

# WORKER
resource "aws_lambda_function" "worker" {
  function_name = "${var.project}-${var.env}-worker"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.worker_zip.output_path
  timeout       = 180
  memory_size   = 1024

  # pymysql layer you prepared
  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    aws_lambda_layer_version.requests_layer.arn
    ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION             = var.region
      DB_SECRET_ARN      = local.lambda_env.DB_SECRET_ARN
      SCRAPER_SECRET_ARN = local.lambda_env.SCRAPER_SECRET_ARN
      CONN_TABLE         = local.lambda_env.CONN_TABLE
      WS_ENDPOINT        = "https://${aws_apigatewayv2_api.ws.id}.execute-api.${var.region}.amazonaws.com/${aws_apigatewayv2_stage.ws_prod.name}"
    }
  }

  depends_on = [aws_apigatewayv2_api.ws, aws_apigatewayv2_stage.ws_prod]
}

# WATCHLIST (read)
resource "aws_lambda_function" "watchlist_read" {
  function_name = "${var.project}-${var.env}-watchlist-read"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler" # file: watchlist/handler.py
  filename      = data.archive_file.watchlist_zip.output_path
  timeout       = 10

  layers = [aws_lambda_layer_version.mysql_layer.arn]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
}

# SQS → worker trigger
resource "aws_lambda_event_source_mapping" "sqs_to_worker" {
  event_source_arn = aws_sqs_queue.main.arn
  function_name    = aws_lambda_function.worker.arn
  batch_size       = 5
  enabled          = true
}
