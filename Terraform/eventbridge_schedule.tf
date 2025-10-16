resource "aws_cloudwatch_event_rule" "every_4h" {
  name                = "${var.project}-${var.env}-every-4h"
  description         = "Run schedule-enqueue lambda to enqueue DISTINCT watchlist URLs"
  schedule_expression = "rate(4 hours)"
}

resource "aws_cloudwatch_event_target" "every_4h_to_lambda" {
  rule      = aws_cloudwatch_event_rule.every_4h.name
  target_id = "schedule-enqueue"
  arn       = aws_lambda_function.schedule_enqueue.arn
}

resource "aws_lambda_permission" "allow_events_invoke_schedule_enqueue" {
  statement_id  = "AllowExecutionFromEventBridgeEvery4h"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.schedule_enqueue.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_4h.arn
}



# EventBridge Rule for Daily Social Scraping


resource "aws_cloudwatch_event_rule" "daily_scrape" {
  name                = "${var.project}-${var.env}-daily-scrape"
  description         = "Trigger social scraper once daily"
  schedule_expression = "cron(0 2 * * ? *)"  # 2 AM UTC daily (10 AM SGT)
  
  # Set to DISABLED by default - enable when ready
  state = "DISABLED"  
}

resource "aws_cloudwatch_event_target" "scrape_target" {
  rule      = aws_cloudwatch_event_rule.daily_scrape.name
  target_id = "SocialScrapeLambda"
  arn       = aws_lambda_function.social_scrape.arn
  
  # Optional: Add retry policy
  retry_policy {
    maximum_retry_attempts = 2
    maximum_event_age_in_seconds    = 3600  # 1 hour
  }
}

# Lambda permission for EventBridge to invoke
resource "aws_lambda_permission" "allow_eventbridge_scrape" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.social_scrape.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_scrape.arn
}