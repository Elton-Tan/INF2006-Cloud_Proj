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

