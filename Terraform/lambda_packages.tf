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

# --------- Zip the new series lambda FOLDER (handler.py inside) ----------
data "archive_file" "watchlist_series_zip" {
  type        = "zip"
  source_dir  = "${path.module}/watchlist_series"
  output_path = "${path.module}/dist/watchlist_series.zip"
}

# --------- Zip the daily trends lambda FOLDER (handler.py inside) ----------
data "archive_file" "trends_daily_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_daily" # folder with handler.py
  output_path = "${path.module}/dist/trends_daily.zip"
}

data "archive_file" "trends_forecast_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_forecast" # folder containing trainer_forecast_handler.py as handler.py
  output_path = "${path.module}/dist/trends_forecast.zip"
}

# --------- Zip: trends_keywords_read (handler.py inside) ----------
data "archive_file" "trends_keywords_read_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_keywords_read" # folder with handler.py
  output_path = "${path.module}/dist/trends_keywords_read.zip"
}

# --------- Zip: trends_keywords_write (handler.py inside) ----------
data "archive_file" "trends_keywords_write_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_keywords_write" # folder with handler.py
  output_path = "${path.module}/dist/trends_keywords_write.zip"
}

# ===== ZIP SOCIAL LAMBDAS =====
data "archive_file" "social_brands_zip" {
  type        = "zip"
  source_dir  = "${path.module}/social_brands"
  output_path = "${path.module}/dist/social_brands.zip"
}

data "archive_file" "social_hashtags_zip" {
  type        = "zip"
  source_dir  = "${path.module}/social_hashtags"
  output_path = "${path.module}/dist/social_hashtags.zip"
}

data "archive_file" "social_influencers_zip" {
  type        = "zip"
  source_dir  = "${path.module}/social_influencers"
  output_path = "${path.module}/dist/social_influencers.zip"
}

data "archive_file" "social_sentiment_zip" {
  type        = "zip"
  source_dir  = "${path.module}/social_sentiment"
  output_path = "${path.module}/dist/social_sentiment.zip"
}

data "archive_file" "social_scrape_zip" {
  type        = "zip"
  source_dir  = "${path.module}/social_scrape"
  output_path = "${path.module}/dist/social_scrape.zip"
}

# ===== ZIP ALERTS LAMBDA =====
data "archive_file" "alerts_read_zip" {
  type        = "zip"
  source_dir  = "${path.module}/alerts_read"
  output_path = "${path.module}/dist/alerts_read.zip"
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
    aws_lambda_layer_version.requests_layer.arn,
    aws_lambda_layer_version.bs4.arn
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


# WATCHLIST (time-series: day/week/month)
resource "aws_lambda_function" "watchlist_series" {
  function_name = "${var.project}-${var.env}-watchlist-series"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler" # file: watchlist_series/handler.py
  filename      = data.archive_file.watchlist_series_zip.output_path
  timeout       = 15
  memory_size   = 256
  architectures = ["x86_64"]

  # Ensure TF updates code when the zip changes
  source_code_hash = filebase64sha256(data.archive_file.watchlist_series_zip.output_path)

  # Uses your existing PyMySQL layer
  layers = [aws_lambda_layer_version.mysql_layer.arn]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
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

data "archive_file" "delete_watchlist_zip" {
  type        = "zip"
  source_dir  = "${path.module}/delete_watchlist"
  output_path = "${path.module}/delete_watchlist.zip"
}

# Lambda function
resource "aws_lambda_function" "delete_watchlist" {
  function_name = "${var.project}-${var.env}-delete-watchlist"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.delete_watchlist_zip.output_path
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]

  # Reuse the same env map you already defined (gives REGION, DB_SECRET_ARN, etc.)
  environment {
    variables = {
      REGION        = local.lambda_env.REGION
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }

  # Same VPC settings as your DB-talking lambdas (so it can reach RDS)
  vpc_config {
    subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    # IMPORTANT: use the SAME security group you use for worker/watchlist_read
    # Replace aws_security_group.lambda.id if your project uses a different one.
    security_group_ids = [aws_security_group.lambda.id]
  }

  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    aws_lambda_layer_version.requests_layer.arn
  ]
}


resource "aws_lambda_function" "trends_keywords_delete" {
  function_name = "${var.project}-${var.env}-trends-keywords-delete"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.trends_keywords_delete_zip.output_path
  timeout       = 10
  memory_size   = 256
  architectures = ["x86_64"]

  # Auto-redeploy when zip changes
  source_code_hash = filebase64sha256(data.archive_file.trends_keywords_delete_zip.output_path)

  # Reuse your PyMySQL layer
  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
      DEFAULT_GEO   = "sg"    # keep consistent with your write function
      SOFT_DELETE   = "false" # set to "true" if you prefer soft delete
    }
  }
}

# ========== ZIP the new scheduler lambda ==========
data "archive_file" "schedule_enqueue_zip" {
  type        = "zip"
  source_dir  = "${path.module}/schedule_enqueue"
  output_path = "${path.module}/dist/schedule_enqueue.zip"
}

data "archive_file" "trends_read_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_read"
  output_path = "${path.module}/dist/trends_read.zip"
}

# --------- Zip: trends_keywords_delete (handler.py inside) ----------
data "archive_file" "trends_keywords_delete_zip" {
  type        = "zip"
  source_dir  = "${path.module}/trends_keywords_delete" # folder with handler.py
  output_path = "${path.module}/dist/trends_keywords_delete.zip"
}


# ========== Lambda function ==========
resource "aws_lambda_function" "schedule_enqueue" {
  function_name = "${var.project}-${var.env}-schedule-enqueue"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.schedule_enqueue_zip.output_path
  timeout       = 30
  memory_size   = 256

  # Needs VPC access to reach RDS (same as worker/watchlist_read)
  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  # Reuse layers that include PyMySQL/requests if you want (PyMySQL required)
  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    aws_lambda_layer_version.requests_layer.arn
  ]

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
      QUEUE_URL     = local.lambda_env.QUEUE_URL
    }
  }
}

# GOOGLE TRENDS (daily ingest)
resource "aws_lambda_function" "trends_daily" {
  function_name = "${var.project}-${var.env}-trends-daily"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler" # file: trends_daily/handler.py
  filename      = data.archive_file.trends_daily_zip.output_path
  timeout       = 60
  memory_size   = 768
  architectures = ["x86_64"]

  # Force re-deploy when code zip changes
  source_code_hash = filebase64sha256(data.archive_file.trends_daily_zip.output_path)

  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    aws_lambda_layer_version.requests_layer.arn, # you already have this
    var.awswrangler_layer_arn,
    aws_lambda_layer_version.pytrends_layer.arn
  ]


  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
      TABLE_NAME    = "google_trends_daily"
      GEO           = "SG"
      DB_NAME       = "spirulinadb"

      # Groups: antifungal|antifungal cream ; spirulina ; skin cream
      KEYWORD_GROUPS = "antifungal|antifungal cream;spirulina;skin cream"

      DAYS_BACK     = "400" # ~13 months, daily
      MAX_KEYS_PER  = "5"
      SLEEP_BETWEEN = "1.2"
      CATEGORY      = "0"
    }
  }
}


# TRENDS (read)
resource "aws_lambda_function" "trends_read" {
  function_name = "${var.project}-${var.env}-trends-read"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.trends_read_zip.output_path
  timeout       = 10
  memory_size   = 256
  architectures = ["x86_64"]

  # Auto-redeploy when zip changes
  source_code_hash = filebase64sha256(data.archive_file.trends_read_zip.output_path)

  # Reuse your MySQL/PyMySQL layer
  layers = [aws_lambda_layer_version.mysql_layer.arn]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
      TABLE_NAME    = "google_trends_daily"
      GEO           = "SG"
      DB_NAME       = "spirulinadb"
      # optional caps
      MAX_SLUGS = "20"
    }
  }
}

resource "aws_lambda_function" "trends_forecast" {
  function_name = "${var.project}-${var.env}-trends-forecast"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler" # file: trends_forecast/handler.py
  filename      = data.archive_file.trends_forecast_zip.output_path
  timeout       = 120
  memory_size   = 1024
  architectures = ["x86_64"]

  # Auto-redeploy when zip changes
  source_code_hash = filebase64sha256(data.archive_file.trends_forecast_zip.output_path)

  # Reuse layers you already have:
  # - mysql_layer        : PyMySQL to talk to RDS
  # - var.awswrangler... : brings in numpy/pandas without you shipping a big layer
  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    var.awswrangler_layer_arn
  ]

  # Same VPC setup as your DB-talking lambdas
  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION         = var.region
      DB_SECRET_ARN  = local.lambda_env.DB_SECRET_ARN
      TABLE_NAME     = "google_trends_daily"    # historical table (same as trends_read)
      KW_TABLE       = "trend_keywords"         # to enumerate active slugs/groups
      FORECAST_TABLE = "google_trends_forecast" # bounded forecast table (PK (geo,slug,day))

      GEO = "SG"

      # Trainer knobs (safe defaults; tweak via TF vars later if you want)
      HISTORY_DAYS   = "420"
      FORECAST_DAYS  = "7"
      MIN_TRAIN_DAYS = "120"
      CV_FOLDS       = "5"
      RIDGE_ALPHAS   = "0,0.1,0.3,1,3,10"
    }
  }
}

# READ keywords: GET /trends/keywords (list with optional filters)
resource "aws_lambda_function" "trends_keywords_read" {
  function_name = "${var.project}-${var.env}-trends-keywords-read"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.trends_keywords_read_zip.output_path
  timeout       = 10
  memory_size   = 256
  architectures = ["x86_64"]

  source_code_hash = filebase64sha256(data.archive_file.trends_keywords_read_zip.output_path)

  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
}

# WRITE keyword: POST /trends/keywords (insert with defaults)
resource "aws_lambda_function" "trends_keywords_write" {
  function_name = "${var.project}-${var.env}-trends-keywords-write"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.trends_keywords_write_zip.output_path
  timeout       = 10
  memory_size   = 256
  architectures = ["x86_64"]

  source_code_hash = filebase64sha256(data.archive_file.trends_keywords_write_zip.output_path)

  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
      DEFAULT_GEO   = "sg" # default geo
    }
  }
}

#social_hashtags 
resource "aws_lambda_function" "social_hashtags" {
  function_name = "${var.project}-${var.env}-social-hashtags"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"  
  filename      = data.archive_file.social_hashtags_zip.output_path
  source_code_hash = data.archive_file.social_hashtags_zip.output_base64sha256 

  timeout       = 30
  memory_size   = 512
  
  
  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
        subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
        security_group_ids = [aws_security_group.lambda.id]
      }
  
  environment {
    variables = {
      REGION = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
 
}
# social_brand
resource "aws_lambda_function" "social_brands" {
  function_name = "${var.project}-${var.env}-social-brands"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.social_brands_zip.output_path
  source_code_hash = data.archive_file.social_brands_zip.output_base64sha256

  timeout     = 30
  memory_size = 512

  layers = [
    aws_lambda_layer_version.mysql_layer.arn  # ✅ ADDED
  ]

  vpc_config {  # ✅ ADDED
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }
  


  environment {
    variables = {
      REGION = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN 
    }
  }
}

#social_influencers
resource "aws_lambda_function" "social_influencers" {
  function_name = "${var.project}-${var.env}-social-influencers"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.social_influencers_zip.output_path
  source_code_hash = data.archive_file.social_influencers_zip.output_base64sha256

  timeout     = 30
  memory_size = 512


  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }
  environment {
    variables = {
      REGION = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
}

#social_sentiment

resource "aws_lambda_function" "social_sentiment" {
  function_name = "${var.project}-${var.env}-social-sentiment"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.social_sentiment_zip.output_path
  source_code_hash = data.archive_file.social_brands_zip.output_base64sha256

  timeout     = 45
  memory_size = 768
  architectures = ["x86_64"]

  layers = [
     aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }
  environment {
    variables = {
      REGION = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
}
#social_scrape
resource "aws_lambda_function" "social_scrape" {
  function_name = "${var.project}-${var.env}-social-scrape"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"  # Confirm this matches the actual entrypoint!
  filename      = data.archive_file.social_scrape_zip.output_path
  source_code_hash = data.archive_file.social_scrape_zip.output_base64sha256

  timeout       = 300 #come back you cannot afford to scrape every 300
  memory_size   = 2048
  

  layers = [
    aws_lambda_layer_version.mysql_layer.arn,
    aws_lambda_layer_version.requests_layer.arn,                  # Has pandas/numpy
    aws_lambda_layer_version.sklearn_layer.arn,  # ✅ Your custom layer
    aws_lambda_layer_version.nltk_layer.arn,     # ✅ Your custom layer



    # "arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python312:13", 
    # "arn:aws:lambda:us-east-1:336392948345:layer:AWSDataWrangler-Python312:13",
    # aws_lambda_layer_version.numpy_layer.arn,
    # "arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p312-scikit-learn:8",
    # "arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p312-nltk:1",

    # aws_lambda_layer_version.sklearn_layer.arn,      
    # aws_lambda_layer_version.textblob_layer.arn, 
    
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION = var.region
      DB_SECRET_ARN      = local.lambda_env.DB_SECRET_ARN
      SCRAPER_SECRET_ARN = aws_secretsmanager_secret.social_scraper.arn
    }
  }
}

# ALERTS READ
resource "aws_lambda_function" "alerts_read" {
  function_name = "${var.project}-${var.env}-alerts-read"
  role          = data.aws_iam_role.labrole.arn
  runtime       = "python3.12"
  handler       = "handler.lambda_handler"
  filename      = data.archive_file.alerts_read_zip.output_path
  timeout       = 10
  memory_size   = 256

  source_code_hash = filebase64sha256(data.archive_file.alerts_read_zip.output_path)

  layers = [
    aws_lambda_layer_version.mysql_layer.arn
  ]

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      REGION        = var.region
      DB_SECRET_ARN = local.lambda_env.DB_SECRET_ARN
    }
  }
}



