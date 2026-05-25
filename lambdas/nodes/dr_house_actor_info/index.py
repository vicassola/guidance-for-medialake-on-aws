"""
Dr. House Actor Info Node.

Downstream demo node fired when a pipeline emits an EventBridge event with
detail.tag = "dr.house". Writes a hardcoded ActorInfo block to the asset's
Metadata.ActorInfo field.
"""

import os
from typing import Any, Dict, Optional

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from lambda_middleware import lambda_middleware

logger = Logger(service="dr-house-actor-info")
tracer = Tracer()

dynamodb = boto3.resource("dynamodb")
asset_table = dynamodb.Table(os.environ["MEDIALAKE_ASSET_TABLE"])

ACTOR_INFO = {
    "show": "House M.D.",
    "cast": [
        {"actor": "Hugh Laurie", "character": "Dr. Gregory House"},
        {"actor": "Lisa Edelstein", "character": "Dr. Lisa Cuddy"},
        {"actor": "Omar Epps", "character": "Dr. Eric Foreman"},
        {"actor": "Robert Sean Leonard", "character": "Dr. James Wilson"},
        {"actor": "Jennifer Morrison", "character": "Dr. Allison Cameron"},
        {"actor": "Jesse Spencer", "character": "Dr. Robert Chase"},
    ],
    "source": "dr_house_actor_info (demo, hardcoded)",
}


def _resolve_inventory_id(event: Dict[str, Any]) -> Optional[str]:
    """Hunt for an inventoryId across the shapes this node may receive.

    When invoked as a downstream pipeline triggered by EventBridge, the
    incoming event is the EventBridge envelope wrapped by Step Functions /
    middleware. We try the most likely locations in order.
    """
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


def _write_actor_info(inventory_id: str) -> None:
    try:
        asset_table.update_item(
            Key={"InventoryID": inventory_id},
            UpdateExpression="SET #m.#ai = :ai",
            ExpressionAttributeNames={"#m": "Metadata", "#ai": "ActorInfo"},
            ExpressionAttributeValues={":ai": ACTOR_INFO},
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ValidationException":
            asset_table.update_item(
                Key={"InventoryID": inventory_id},
                UpdateExpression="SET #m = :m",
                ExpressionAttributeNames={"#m": "Metadata"},
                ExpressionAttributeValues={":m": {"ActorInfo": ACTOR_INFO}},
            )
        else:
            raise


@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    inventory_id = _resolve_inventory_id(event)
    if not inventory_id:
        raise ValueError("dr_house_actor_info: could not resolve InventoryID from event")

    _write_actor_info(inventory_id)
    logger.info(
        "dr_house_actor_info: wrote ActorInfo",
        extra={"inventory_id": inventory_id, "cast_size": len(ACTOR_INFO["cast"])},
    )

    return {
        "status": "ok",
        "inventoryId": inventory_id,
        "actorInfo": ACTOR_INFO,
    }
