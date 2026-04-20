"""
PDF Thumbnail Node

Rasterizes the first page of a PDF stored in S3 to a PNG thumbnail using
PyMuPDF (fitz) — a pure-Python binding that bundles MuPDF statically, so
no extra Lambda layer is needed.

Follows the exact same pattern as image_thumbnail:
  - Saves the PNG to MEDIA_ASSETS_BUCKET_NAME
  - Writes a DerivedRepresentation with Purpose="thumbnail" to DynamoDB
  - Returns updatedAsset so the middleware forwards the full record downstream
"""

import io
import json
import os
import struct
from decimal import Decimal
from typing import Any, Dict

import boto3
import fitz  # PyMuPDF
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from lambda_middleware import lambda_middleware
from nodes_utils import generate_derived_filename

logger = Logger()
tracer = Tracer()

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb").Table(os.environ["MEDIALAKE_ASSET_TABLE"])

# Thumbnail dimensions — match image_thumbnail defaults
THUMBNAIL_WIDTH = 300

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def clean_asset_id(raw: str) -> str:
    parts = raw.split(":")
    uuid_part = parts[-1] if parts[-1] != "master" else parts[-2]
    return f"asset:uuid:{uuid_part}"


def _convert_decimals(obj: Any) -> Any:
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def render_first_page(pdf_bytes: bytes, width: int = THUMBNAIL_WIDTH) -> bytes:
    """
    Render the first page of a PDF to PNG bytes using PyMuPDF.

    Args:
        pdf_bytes: Raw PDF file content
        width: Target width in pixels (height is computed to preserve aspect ratio)

    Returns:
        PNG image bytes
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[0]  # first page

        # Scale so the rendered width matches the target
        zoom = width / page.rect.width
        mat = fitz.Matrix(zoom, zoom)

        # Render to a pixmap (RGB, no alpha)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        return pix.tobytes("png")
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------


@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    assets = event.get("payload", {}).get("assets", [])
    if not assets:
        raise ValueError("No assets found in event.payload.assets")

    asset = assets[0]
    inv_raw = asset.get("InventoryID")
    if not inv_raw:
        raise ValueError("Missing InventoryID")
    inv_id = clean_asset_id(inv_raw)

    loc = asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
        "PrimaryLocation"
    ]
    bucket = loc["Bucket"]
    key = loc["ObjectKey"]["FullPath"]

    out_bucket = os.environ.get("MEDIA_ASSETS_BUCKET_NAME")
    if not out_bucket:
        raise ValueError("MEDIA_ASSETS_BUCKET_NAME env-var missing")

    logger.info(
        "Generating PDF thumbnail",
        extra={"inventory_id": inv_id, "bucket": bucket, "key": key},
    )

    # ── fetch PDF from S3 ──────────────────────────────────────────────────
    pdf_bytes = s3.get_object(Bucket=bucket, Key=key)["Body"].read()

    # ── rasterize first page ───────────────────────────────────────────────
    png_bytes = render_first_page(pdf_bytes, width=THUMBNAIL_WIDTH)

    # ── build output key (mirrors image_thumbnail pattern) ─────────────────
    out_key = f"{bucket}/{generate_derived_filename(key, 'thumbnail', 'png')}"

    # ── delete any existing thumbnail ─────────────────────────────────────
    try:
        s3.delete_object(Bucket=out_bucket, Key=out_key)
        logger.info("Deleted existing thumbnail", extra={"key": out_key})
    except ClientError as err:
        logger.warning("No existing thumbnail to delete", extra={"error": str(err)})

    # ── upload new thumbnail ───────────────────────────────────────────────
    s3.put_object(
        Bucket=out_bucket,
        Key=out_key,
        Body=png_bytes,
        ContentType="image/png",
    )

    logger.info(
        "Thumbnail uploaded",
        extra={"bucket": out_bucket, "key": out_key, "size": len(png_bytes)},
    )

    # ── update DerivedRepresentations in DynamoDB ──────────────────────────
    resp = dynamo.get_item(Key={"InventoryID": inv_id})
    cur_reps = resp.get("Item", {}).get("DerivedRepresentations") or []
    # Remove any previous thumbnail for this asset
    cur_reps = [r for r in cur_reps if r.get("Purpose") != "thumbnail"]

    # Determine rendered dimensions from the PNG header (bytes 16-24)
    w = struct.unpack(">I", png_bytes[16:20])[0]
    h = struct.unpack(">I", png_bytes[20:24])[0]

    new_rep = {
        "ID": f"{inv_id}:thumbnail",
        "Type": "Image",
        "Format": "PNG",
        "Purpose": "thumbnail",
        "StorageInfo": {
            "PrimaryLocation": {
                "StorageType": "s3",
                "Provider": "aws",
                "Bucket": out_bucket,
                "ObjectKey": {"FullPath": out_key},
                "Status": "active",
                "FileInfo": {"Size": len(png_bytes)},
            }
        },
        "ImageSpec": {"Resolution": {"Width": w, "Height": h}},
    }

    dynamo.update_item(
        Key={"InventoryID": inv_id},
        UpdateExpression="SET DerivedRepresentations = :dr",
        ExpressionAttributeValues={":dr": cur_reps + [new_rep]},
    )

    updated_item = _convert_decimals(
        dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})
    )

    logger.info("DynamoDB updated", extra={"inventory_id": inv_id})

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "bucket": out_bucket,
                "key": out_key,
                "width": w,
                "height": h,
            }
        ),
        "updatedAsset": updated_item,
    }
