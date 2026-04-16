"""
PDF Metadata Extractor Node

Extracts document metadata from PDF files stored in S3 using pypdf and stores
the results in the asset's Metadata.EmbeddedMetadata.pdf field in DynamoDB.
"""

import io
import json
import os
from decimal import Decimal
from typing import Any, Dict, Optional

import boto3
import pypdf
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from lambda_middleware import lambda_middleware

logger = Logger()
tracer = Tracer()

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb").Table(os.environ["MEDIALAKE_ASSET_TABLE"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def clean_asset_id(raw: str) -> str:
    parts = raw.split(":")
    uuid_part = parts[-1] if parts[-1] != "master" else parts[-2]
    return f"asset:uuid:{uuid_part}"


def _to_decimal(obj: Any) -> Any:
    """Recursively convert floats/ints to Decimal for DynamoDB storage."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, int):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _strip_decimals(obj: Any) -> Any:
    """Recursively convert Decimal back to int/float for JSON serialization."""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _strip_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_decimals(v) for v in obj]
    return obj


def _safe_str(value: Any) -> Optional[str]:
    """Convert a metadata value to string, returning None for empty/None values."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def extract_pdf_metadata(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Extract metadata from PDF bytes using pypdf.

    Returns a dict with:
      - title, author, subject, creator, producer, keywords
      - page_count
      - pdf_version
      - is_encrypted
      - creation_date, modification_date (ISO strings when parseable)
    """
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))

    # Basic document info
    info = reader.metadata or {}

    # pypdf exposes metadata keys with /Title, /Author etc. prefixes
    def _get(key: str) -> Optional[str]:
        return _safe_str(info.get(f"/{key}") or info.get(key))

    metadata: Dict[str, Any] = {
        "page_count": len(reader.pages),
        "is_encrypted": reader.is_encrypted,
        "pdf_version": _safe_str(getattr(reader, "pdf_header", None)),
        "title": _get("Title"),
        "author": _get("Author"),
        "subject": _get("Subject"),
        "creator": _get("Creator"),
        "producer": _get("Producer"),
        "keywords": _get("Keywords"),
        "creation_date": _safe_str(_get("CreationDate")),
        "modification_date": _safe_str(_get("ModDate")),
    }

    # Remove None values to keep DynamoDB record clean
    return {k: v for k, v in metadata.items() if v is not None}


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

    updated_item: Dict[str, Any] = {}

    for asset in assets:
        inv_raw = asset.get("InventoryID")
        if not inv_raw:
            logger.warning("Skipping asset without InventoryID")
            continue

        inv_id = clean_asset_id(inv_raw)

        loc = asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
            "PrimaryLocation"
        ]
        bucket = loc["Bucket"]
        key = loc["ObjectKey"]["FullPath"]

        logger.info(
            "Extracting PDF metadata",
            extra={"inventory_id": inv_id, "bucket": bucket, "key": key},
        )

        # ── fetch PDF from S3 ──────────────────────────────────────────────
        pdf_bytes = s3.get_object(Bucket=bucket, Key=key)["Body"].read()

        # ── extract metadata ───────────────────────────────────────────────
        pdf_meta = extract_pdf_metadata(pdf_bytes)

        logger.info(
            "Extracted PDF metadata",
            extra={"inventory_id": inv_id, "page_count": pdf_meta.get("page_count")},
        )

        # ── merge with existing EmbeddedMetadata and write to DynamoDB ─────
        existing = (
            dynamo.get_item(Key={"InventoryID": inv_id})
            .get("Item", {})
            .get("Metadata", {})
            .get("EmbeddedMetadata", {})
        )
        merged = {**existing, "pdf": _to_decimal(pdf_meta)}

        dynamo.update_item(
            Key={"InventoryID": inv_id},
            UpdateExpression="SET #md.#em = :m",
            ExpressionAttributeNames={"#md": "Metadata", "#em": "EmbeddedMetadata"},
            ExpressionAttributeValues={":m": merged},
        )

        updated_item = _strip_decimals(
            dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})
        )

        logger.info("DynamoDB updated", extra={"inventory_id": inv_id})

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": f"Processed {len(assets)} assets",
                "pageCount": pdf_meta.get("page_count") if assets else 0,
            }
        ),
        "updatedAsset": updated_item,
    }
