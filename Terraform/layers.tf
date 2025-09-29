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
