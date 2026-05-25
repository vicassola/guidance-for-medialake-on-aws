"""
Chicago Fire Highlights Node.

Downstream demo node fired when a pipeline emits an EventBridge event with
detail.tag = "chicago-fire". Reads the video duration that
video_metadata_extractor previously wrote to the asset, generates N random
highlight timestamps within that duration, and stores them under
Metadata.Highlights.
"""

import os
import random
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from lambda_middleware import lambda_middleware

logger = Logger(service="chicago-fire-highlights")
tracer = Tracer()

dynamodb = boto3.resource("dynamodb")
asset_table = dynamodb.Table(os.environ["MEDIALAKE_ASSET_TABLE"])

HIGHLIGHT_COUNT = 5
# Fallback duration in seconds when the video metadata is not yet on the asset.
# Picks ~40 minutes which is a reasonable order of magnitude for a TV episode demo.
FALLBACK_DURATION_SECONDS = 2400.0


def _resolve_inventory_id(event: Dict[str, Any]) -> Optional[str]:
    payload = event.get("payload", {}) or {}

    assets = payload.get("assets") or []
    if assets and isinstance(assets[0], dict):
        inv = assets[0].get("InventoryID")
        if inv:
            return inv

    data = payload.get("data") or {}
    if isinstance(data, dict):
        for key in ("inventoryId", "InventoryID"):
            if data.get(key):
                return data[key]

    detail = event.get("detail")
    if isinstance(detail, dict):
        for key in ("inventoryId", "InventoryID"):
            if detail.get(key):
                return detail[key]

    return None


def _fetch_asset(inventory_id: str) -> Dict[str, Any]:
    resp = asset_table.get_item(Key={"InventoryID": inventory_id})
    item = resp.get("Item") or {}
    return item


def _extract_duration(asset: Dict[str, Any]) -> float:
    """video_metadata_extractor stores duration under
    Metadata.EmbeddedMetadata.General.Duration as a string of seconds.
    We accept a few near-by locations defensively for the demo."""
    metadata = asset.get("Metadata", {}) or {}

    candidates = [
        metadata.get("EmbeddedMetadata", {}).get("General", {}).get("Duration"),
        metadata.get("VideoMetadata", {}).get("Duration"),
        metadata.get("Duration"),
    ]
    for raw in candidates:
        if raw is None:
            continue
        try:
            value = float(raw) if not isinstance(raw, Decimal) else float(raw)
            if value > 0:
                return value
        except (TypeError, ValueError):
            continue

    logger.info(
        "chicago_fire_highlights: no duration on asset, using fallback",
        extra={"fallback_seconds": FALLBACK_DURATION_SECONDS},
    )
    return FALLBACK_DURATION_SECONDS


def _build_highlights(duration_seconds: float) -> List[Dict[str, Any]]:
    raw_ts = sorted(random.uniform(0, duration_seconds) for _ in range(HIGHLIGHT_COUNT))
    return [
        {"t": Decimal(f"{ts:.2f}"), "label": f"Highlight {i + 1}"}
        for i, ts in enumerate(raw_ts)
    ]


def _write_highlights(inventory_id: str, highlights: List[Dict[str, Any]]) -> None:
    try:
        asset_table.update_item(
            Key={"InventoryID": inventory_id},
            UpdateExpression="SET #m.#h = :h",
            ExpressionAttributeNames={"#m": "Metadata", "#h": "Highlights"},
            ExpressionAttributeValues={":h": highlights},
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ValidationException":
            asset_table.update_item(
                Key={"InventoryID": inventory_id},
                UpdateExpression="SET #m = :m",
                ExpressionAttributeNames={"#m": "Metadata"},
                ExpressionAttributeValues={":m": {"Highlights": highlights}},
            )
        else:
            raise


@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    inventory_id = _resolve_inventory_id(event)
    if not inventory_id:
        raise ValueError("chicago_fire_highlights: could not resolve InventoryID")

    asset = _fetch_asset(inventory_id)
    if not asset:
        raise ValueError(
            f"chicago_fire_highlights: asset not found in DDB: {inventory_id}"
        )

    duration = _extract_duration(asset)
    highlights = _build_highlights(duration)
    _write_highlights(inventory_id, highlights)

    logger.info(
        "chicago_fire_highlights: wrote highlights",
        extra={
            "inventory_id": inventory_id,
            "duration_seconds": duration,
            "highlight_count": len(highlights),
        },
    )

    return {
        "status": "ok",
        "inventoryId": inventory_id,
        "durationSeconds": duration,
        "highlights": [{"t": float(h["t"]), "label": h["label"]} for h in highlights],
    }
