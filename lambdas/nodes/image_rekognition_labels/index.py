import json
import os
from decimal import Decimal
from typing import Any, Dict, List

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from lambda_middleware import lambda_middleware

logger = Logger()
tracer = Tracer()

rekognition = boto3.client("rekognition")
dynamo = boto3.resource("dynamodb").Table(os.environ["MEDIALAKE_ASSET_TABLE"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean_asset_id(raw: str) -> str:
    parts = raw.split(":")
    uuid_part = parts[-1] if parts[-1] != "master" else parts[-2]
    return f"asset:uuid:{uuid_part}"


def _to_decimal(obj: Any) -> Any:
    """Recursively convert floats to Decimal for DynamoDB storage."""
    if isinstance(obj, float):
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


def _normalize_labels(raw_labels: List[Dict]) -> List[Dict]:
    """
    Flatten Rekognition label response into a clean, storage-friendly structure.
    Each label keeps its name, confidence, and any parent category names.
    """
    normalized = []
    for label in raw_labels:
        normalized.append(
            {
                "name": label["Name"],
                "confidence": round(label["Confidence"], 2),
                "categories": [c["Name"] for c in label.get("Categories", [])],
                "parents": [p["Name"] for p in label.get("Parents", [])],
            }
        )
    return normalized


def _extract_from_event(event: Dict) -> tuple:
    """Support both standardized middleware shape and direct invocation."""
    payload = event.get("payload", {})
    assets = payload.get("assets") or event.get("assets")
    if not assets:
        raise ValueError("No assets found in event.payload.assets")

    params = payload.get("data", {}) if payload else {}
    max_labels = int(params.get("max_labels", 50))
    min_confidence = float(params.get("min_confidence", 70.0))
    return assets, max_labels, min_confidence


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    assets, max_labels, min_confidence = _extract_from_event(event)

    results = []

    for asset in assets:
        inv_raw = asset.get("InventoryID")
        if not inv_raw:
            logger.warning("Skipping asset without InventoryID")
            continue

        inv_id = clean_asset_id(inv_raw)

        loc = (
            asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
                "PrimaryLocation"
            ]
        )
        bucket = loc["Bucket"]
        key = loc["ObjectKey"]["FullPath"]

        logger.info(
            "Detecting labels",
            extra={"inventory_id": inv_id, "bucket": bucket, "key": key},
        )

        # ── call Rekognition ───────────────────────────────────────────────
        response = rekognition.detect_labels(
            Image={"S3Object": {"Bucket": bucket, "Name": key}},
            MaxLabels=max_labels,
            MinConfidence=min_confidence,
        )

        labels = _normalize_labels(response.get("Labels", []))
        label_model_version = response.get("LabelModelVersion", "")

        logger.info(
            "Rekognition returned labels",
            extra={"count": len(labels), "inventory_id": inv_id},
        )

        # ── build metadata block ───────────────────────────────────────────
        rekognition_metadata = _to_decimal(
            {
                "labels": labels,
                "labelModelVersion": label_model_version,
                "maxLabels": max_labels,
                "minConfidence": min_confidence,
            }
        )

        # ── merge with existing EmbeddedMetadata and write to DynamoDB ─────
        existing = (
            dynamo.get_item(Key={"InventoryID": inv_id})
            .get("Item", {})
            .get("Metadata", {})
            .get("EmbeddedMetadata", {})
        )
        merged = {**existing, "rekognition": rekognition_metadata}

        dynamo.update_item(
            Key={"InventoryID": inv_id},
            UpdateExpression="SET #md.#em = :m",
            ExpressionAttributeNames={"#md": "Metadata", "#em": "EmbeddedMetadata"},
            ExpressionAttributeValues={":m": merged},
        )

        updated_item = dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})

        results.append(
            {
                "inventoryId": inv_id,
                "status": "OK",
                "labelCount": len(labels),
            }
        )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": f"Processed {len(results)} assets",
                "results": results,
            }
        ),
        "updatedAsset": _strip_decimals(updated_item) if assets else {},
    }
