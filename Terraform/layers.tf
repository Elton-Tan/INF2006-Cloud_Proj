data "archive_file" "mysql_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/mysql_layer"
  output_path = "${path.module}/mysql_layer.zip"
}

resource "aws_lambda_layer_version" "mysql_layer" {
  layer_name          = "${var.project}-mysql"
  filename            = data.archive_file.mysql_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
}

data "archive_file" "requests_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/requests_layer"
  output_path = "${path.module}/requests_layer.zip"
}

# Publish the requests layer
resource "aws_lambda_layer_version" "requests_layer" {
  layer_name          = "${var.project}-requests"
  filename            = data.archive_file.requests_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
}

resource "aws_lambda_layer_version" "bs4" {
  layer_name          = "beautifulsoup4"
  filename            = "${path.module}/layers/bs4_layer.zip"
  compatible_runtimes = ["python3.12"] # adjust if your worker uses a different runtime
  description         = "BeautifulSoup4 + soupsieve for Python Lambda"
}

# ===== numpy-only layer =====
data "archive_file" "numpy_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/numpy_layer"
  output_path = "${path.module}/numpy_layer.zip"
}


resource "aws_s3_object" "numpy_layer" {
  bucket = aws_s3_bucket.lambda_layers.id
  key    = "lambda-layers/numpy-layer.zip"
  source = data.archive_file.numpy_layer_zip.output_path
  etag   = data.archive_file.numpy_layer_zip.output_md5
}


resource "aws_lambda_layer_version" "numpy_layer" {
  layer_name          = "${var.project}-numpy"
  s3_bucket           = aws_s3_object.numpy_layer.bucket
  s3_key              = aws_s3_object.numpy_layer.key
  compatible_runtimes = ["python3.12"]
  description         = "NumPy 1.26.x for Lambda"
}

# ===== pandas layer (NO numpy inside) =====
data "archive_file" "pandas_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/pandas_layer"
  output_path = "${path.module}/pandas_layer.zip"
}

resource "aws_lambda_layer_version" "pandas_layer" {
  layer_name          = "${var.project}-pandas"
  filename            = data.archive_file.pandas_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
  description         = "Pandas 2.2.x (+dateutil+pytz) for Lambda"
}

# ===== pytrends-only layer =====
data "archive_file" "pytrends_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/pytrends_layer" # contains python/pytrends
  output_path = "${path.module}/pytrends_layer.zip"
}

resource "aws_lambda_layer_version" "pytrends_layer" {
  layer_name          = "${var.project}-pytrends"
  filename            = data.archive_file.pytrends_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
  description         = "pytrends only"
}


# Add these to the end of layers.tf:



# ===== textblob layer =====
data "archive_file" "textblob_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/textblob_layer"
  output_path = "${path.module}/textblob_layer.zip"
}

resource "aws_lambda_layer_version" "textblob_layer" {
  layer_name          = "${var.project}-textblob"
  filename            = data.archive_file.textblob_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
  description         = "TextBlob for sentiment"
}

# Upload OPTIMIZED sklearn layer to S3
resource "aws_s3_object" "sklearn_layer" {
  bucket = aws_s3_bucket.lambda_layers.id
  key    = "sklearn_layer_optimized.zip"
  source = "${path.module}/sklearn_layer_optimized.zip"  # ✅ New filename
  etag   = filemd5("${path.module}/sklearn_layer_optimized.zip")
}

# Scikit-learn layer (via S3)
resource "aws_lambda_layer_version" "sklearn_layer" {
  layer_name          = "${var.project}-sklearn-layer"
  s3_bucket           = aws_s3_bucket.lambda_layers.id
  s3_key              = aws_s3_object.sklearn_layer.key
  compatible_runtimes = ["python3.12"]
  source_code_hash    = filebase64sha256("${path.module}/sklearn_layer_optimized.zip")  # ✅ New filename
}

# NLTK layer stays the same
resource "aws_lambda_layer_version" "nltk_layer" {
  filename            = "${path.module}/nltk_layer.zip"
  layer_name          = "${var.project}-nltk-layer"
  compatible_runtimes = ["python3.12"]
  source_code_hash    = filebase64sha256("${path.module}/nltk_layer.zip")
}

# rapidfuzz layer
data "archive_file" "rapidfuzz_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/rapidfuzz_layer"
  output_path = "${path.module}/rapidfuzz_layer.zip"
}

resource "aws_lambda_layer_version" "rapidfuzz_layer" {
  layer_name          = "${var.project}-rapidfuzz"
  filename            = data.archive_file.rapidfuzz_layer_zip.output_path
  compatible_runtimes = ["python3.12"]
  description         = "rapidfuzz for fuzzy string matching"
}