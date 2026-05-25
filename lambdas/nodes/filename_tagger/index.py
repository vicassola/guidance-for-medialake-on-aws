"""
Filename Tagger Node.

Inspects the asset's filename and assigns one or more semantic tags
to the asset's DynamoDB record under Metadata.Tags. The matched tag
is also returned in the step output (and as customDetail) so that
publish_event can forward it on the EventBridge bus for downstream
pipelines to filter on.
"""

import os
from typing import Any, Dict, List, Optional

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from lambda_middleware import lambda_middleware

logger = Logger(service="filename-tagger")
tracer = Tracer()

dynamodb = boto3.resource("dynamodb")
asset_table = dynamodb.Table(os.environ["MEDIALAKE_ASSET_TABLE"])

# (substring-to-match-in-filename, tag-to-apply) - first match wins.
TAG_RULES: List[tuple[str, str]] = [
    ("house", "dr.house"),
    ("chicago", "chicago-fire"),
]


def _extract_filename(asset: Dict[str, Any]) -> Optional[str]:
    dsa = asset.get("DigitalSourceAsset", {}) or {}
    main_rep = dsa.get("MainRepresentation", {}) or {}
    storage = main_rep.get("StorageInfo", {}) or {}
    primary = storage.get("PrimaryLocation", {}) or {}
    object_key = primary.get("ObjectKey", {}) or {}
    name = object_key.get("Name")
    if name:
        return name
    full_path = object_key.get("FullPath")
    if full_path:
        return full_path.rsplit("/", 1)[-1]
    return None


def _resolve_tag(filename: str) -> Optional[str]:
    lower = filename.lower()
    for needle, tag in TAG_RULES:
        if needle in lower:
            return tag
    return None


def _append_tag(inventory_id: str, tag: str) -> None:
    """Append `tag` to Metadata.Tags, creating the structure if missing."""
    try:
        asset_table.update_item(
            Key={"InventoryID": inventory_id},
            UpdateExpression=(
                "SET #m.#tags = list_append(if_not_exists(#m.#tags, :empty), :new)"
            ),
            ExpressionAttributeNames={"#m": "Metadata", "#tags": "Tags"},
            ExpressionAttributeValues={":empty": [], ":new": [tag]},
        )
    except ClientError as e:
        # If Metadata map itself does not yet exist, create it then retry.
        if e.response.get("Error", {}).get("Code") == "ValidationException":
            asset_table.update_item(
                Key={"InventoryID": inventory_id},
                UpdateExpression="SET #m = :m",
                ExpressionAttributeNames={"#m": "Metadata"},
                ExpressionAttributeValues={":m": {"Tags": [tag]}},
            )
        else:
            raise


@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    assets = event.get("payload", {}).get("assets", []) or []
    if not assets:
        raise ValueError("filename_tagger: no assets found in payload")

    asset = assets[0]
    inventory_id = asset.get("InventoryID")
    if not inventory_id:
        raise ValueError("filename_tagger: asset is missing InventoryID")

    filename = _extract_filename(asset)
    if not filename:
        logger.warning(
            "filename_tagger: could not resolve filename, skipping",
            extra={"inventory_id": inventory_id},
        )
        return {
            "status": "no_filename",
            "inventoryId": inventory_id,
            "customDetail": {"inventoryId": inventory_id, "tag": None},
        }

    tag = _resolve_tag(filename)
    if not tag:
        logger.info(
            "filename_tagger: no tag rule matched",
            extra={"inventory_id": inventory_id, "asset_filename": filename},
        )
        return {
            "status": "no_match",
            "inventoryId": inventory_id,
            "filename": filename,
            "customDetail": {"inventoryId": inventory_id, "tag": None},
        }

    _append_tag(inventory_id, tag)
    logger.info(
        "filename_tagger: applied tag",
        extra={"inventory_id": inventory_id, "asset_filename": filename, "tag": tag},
    )

    return {
        "status": "tagged",
        "inventoryId": inventory_id,
        "filename": filename,
        "tag": tag,
        # publish_event will merge customDetail into the published EventBridge detail,
        # so downstream pipelines can filter rules on detail.tag.
        "customDetail": {"inventoryId": inventory_id, "tag": tag},
    }
