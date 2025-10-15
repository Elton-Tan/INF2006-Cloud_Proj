resource "aws_dynamodb_table" "conns" {
  name         = "${var.project}-pubsub"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "pk"
  range_key = "sk"

  # Attribute definitions (every key used in table or indexes must be declared)
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "connectionId"
    type = "S"
  }

  global_secondary_index {
    name               = "gsi_conn"
    hash_key           = "connectionId"
    projection_type    = "INCLUDE"
    non_key_attributes = ["pk", "sk"]
  }

  ttl {
    attribute_name = "ttl" # no schema entry needed for TTL attr
    enabled        = true
  }

  tags = { Name = "${var.project}-${var.env}-conns" }
}
