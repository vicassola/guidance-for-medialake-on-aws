"""
GET /assets/{id}/view

Proxies the original asset file from S3 back to the browser with
Content-Type and Content-Disposition: inline headers.

This endpoint exists to solve the CORS problem: the original file may live
in any connector bucket (not the media-assets bucket), and those buckets
don't have CORS rules that allow the CloudFront UI domain.  By routing the
request through API Gateway we avoid cross-origin issues entirely.

The response is streamed as a base64-encoded binary payload using API
Gateway's binary media type support.
"""

import base64
import json
import os
from typing import Any, Dict, Optional
from urllib.parse import unquote

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.config import Config
from botocore.exceptions import ClientError

logger = Logger(service="asset-view-service")
tracer = Tracer(service="asset-view-service")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["MEDIALAKE_ASSET_TABLE"])

_SIGV4_CFG = Config(signature_version="s3v4")
_s3 = boto3.client("s3", config=_SIGV4_CFG)

# Maximum file size to proxy inline (50 MB).
# Larger files should be downloaded via presigned URL instead.
MAX_INLINE_BYTES = 50 * 1024 * 1024

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
}


def _error(status: int, message: str) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"status": "error", "message": message}),
    }


def _get_asset(inventory_id: str) -> Optional[Dict[str, Any]]:
    try:
        resp = table.get_item(Key={"InventoryID": inventory_id})
        return resp.get("Item")
    except ClientError as exc:
        logger.error(f"DynamoDB error: {exc}")
        return None


@tracer.capture_lambda_handler
@logger.inject_lambda_context
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    # Handle CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    # Extract and decode asset ID from path
    raw_id = (event.get("pathParameters") or {}).get("id", "")
    inventory_id = unquote(raw_id)

    if not inventory_id:
        return _error(400, "Missing asset ID")

    # Fetch asset record
    asset = _get_asset(inventory_id)
    if not asset:
        return _error(404, f"Asset {inventory_id} not found")

    # Locate the source file
    try:
        loc = (
            asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
                "PrimaryLocation"
            ]
        )
        bucket = loc["Bucket"]
        key = loc["ObjectKey"]["FullPath"]
        filename = loc["ObjectKey"].get("Name") or key.split("/")[-1]
    except (KeyError, TypeError) as exc:
        logger.error(f"Malformed asset record: {exc}")
        return _error(500, "Malformed asset storage information")

    # Fetch from S3
    try:
        s3_resp = _s3.get_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        logger.error(f"S3 error fetching {bucket}/{key}: {code}")
        if code in ("NoSuchKey", "NoSuchBucket"):
            return _error(404, "File not found in S3")
        return _error(500, f"S3 error: {code}")

    content_length = s3_resp.get("ContentLength", 0)
    if content_length > MAX_INLINE_BYTES:
        return _error(
            413,
            f"File too large to view inline ({content_length} bytes). "
            "Use the download button instead.",
        )

    content_type = s3_resp.get("ContentType", "application/octet-stream")
    body_bytes = s3_resp["Body"].read()

    # API Gateway requires binary responses to be base64-encoded
    return {
        "statusCode": 200,
        "headers": {
            **CORS_HEADERS,
            "Content-Type": content_type,
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(len(body_bytes)),
            "Cache-Control": "private, max-age=3600",
        },
        "isBase64Encoded": True,
        "body": base64.b64encode(body_bytes).decode("utf-8"),
    }
