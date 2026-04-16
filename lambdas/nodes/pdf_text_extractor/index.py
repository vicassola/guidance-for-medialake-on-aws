"""
PDF Text Extractor Node

Two-action node that wraps Amazon Textract's async document analysis API:

  Action 1 – extract:
    Calls textract:StartDocumentAnalysis with TABLES + FORMS feature types.
    Returns the Textract JobId as externalJobId so the pipeline's Wait/Choice
    loop can poll for completion.

  Action 2 – status:
    Calls textract:GetDocumentAnalysis, paginates through all result blocks,
    assembles full text, structured tables, and form key-value pairs, then
    writes everything to DynamoDB (Metadata.EmbeddedMetadata.textract) and
    stores the raw extracted text in S3 for downstream embedding nodes.

Both actions share the same lambda_handler entry point; the action is
determined by the presence of externalJobId in the event metadata.
"""

import json
import os
import re
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from lambda_middleware import lambda_middleware

logger = Logger()
tracer = Tracer()

textract = boto3.client("textract")
s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb").Table(os.environ["MEDIALAKE_ASSET_TABLE"])

MEDIA_ASSETS_BUCKET = os.environ.get("MEDIA_ASSETS_BUCKET_NAME", "")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def clean_asset_id(raw: str) -> str:
    parts = raw.split(":")
    uuid_part = parts[-1] if parts[-1] != "master" else parts[-2]
    return f"asset:uuid:{uuid_part}"


def _to_decimal(obj: Any) -> Any:
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
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _strip_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_decimals(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Textract result parsing
# ---------------------------------------------------------------------------


def _paginate_textract_results(job_id: str) -> List[Dict]:
    """Collect all Block objects across all Textract result pages."""
    blocks: List[Dict] = []
    next_token: Optional[str] = None

    while True:
        kwargs: Dict[str, Any] = {"JobId": job_id}
        if next_token:
            kwargs["NextToken"] = next_token

        response = textract.get_document_analysis(**kwargs)
        status = response.get("JobStatus")

        if status == "IN_PROGRESS":
            return []  # Signal: not ready yet

        if status == "FAILED":
            raise RuntimeError(
                f"Textract job {job_id} failed: "
                + response.get("StatusMessage", "unknown error")
            )

        blocks.extend(response.get("Blocks", []))
        next_token = response.get("NextToken")
        if not next_token:
            break

    return blocks


def _extract_full_text(blocks: List[Dict]) -> str:
    """Concatenate all LINE blocks in reading order to produce full document text."""
    lines = [
        b["Text"]
        for b in blocks
        if b.get("BlockType") == "LINE" and b.get("Text")
    ]
    return "\n".join(lines)


def _build_block_map(blocks: List[Dict]) -> Dict[str, Dict]:
    return {b["Id"]: b for b in blocks}


def _get_children_text(block: Dict, block_map: Dict[str, Dict]) -> str:
    """Recursively collect text from WORD children of a CELL or KEY_VALUE_SET block."""
    words: List[str] = []
    for rel in block.get("Relationships", []):
        if rel["Type"] == "CHILD":
            for child_id in rel["Ids"]:
                child = block_map.get(child_id, {})
                if child.get("BlockType") == "WORD":
                    words.append(child.get("Text", ""))
                elif child.get("BlockType") == "SELECTION_ELEMENT":
                    words.append(
                        "SELECTED"
                        if child.get("SelectionStatus") == "SELECTED"
                        else "NOT_SELECTED"
                    )
    return " ".join(words).strip()


def _extract_tables(blocks: List[Dict]) -> List[Dict]:
    """
    Build structured table representations from TABLE/CELL blocks.
    Returns a list of tables, each as {"rows": [[cell_text, ...], ...]}.
    """
    block_map = _build_block_map(blocks)
    tables: List[Dict] = []

    for block in blocks:
        if block.get("BlockType") != "TABLE":
            continue

        # Collect all CELL children
        cells: Dict[Tuple[int, int], str] = {}
        for rel in block.get("Relationships", []):
            if rel["Type"] == "CHILD":
                for child_id in rel["Ids"]:
                    cell = block_map.get(child_id, {})
                    if cell.get("BlockType") == "CELL":
                        row = cell.get("RowIndex", 1)
                        col = cell.get("ColumnIndex", 1)
                        cells[(row, col)] = _get_children_text(cell, block_map)

        if not cells:
            continue

        max_row = max(r for r, _ in cells)
        max_col = max(c for _, c in cells)

        rows = [
            [cells.get((r, c), "") for c in range(1, max_col + 1)]
            for r in range(1, max_row + 1)
        ]
        tables.append({"rows": rows})

    return tables


def _extract_forms(blocks: List[Dict]) -> List[Dict]:
    """
    Build key-value pairs from KEY_VALUE_SET blocks.
    Returns a list of {"key": str, "value": str} dicts.
    """
    block_map = _build_block_map(blocks)
    forms: List[Dict] = []

    for block in blocks:
        if block.get("BlockType") != "KEY_VALUE_SET":
            continue
        if "KEY" not in block.get("EntityTypes", []):
            continue

        key_text = _get_children_text(block, block_map)

        # Find the VALUE block linked to this KEY
        value_text = ""
        for rel in block.get("Relationships", []):
            if rel["Type"] == "VALUE":
                for val_id in rel["Ids"]:
                    val_block = block_map.get(val_id, {})
                    value_text = _get_children_text(val_block, block_map)
                    break

        if key_text:
            forms.append({"key": key_text, "value": value_text})

    return forms


# ---------------------------------------------------------------------------
# S3 text storage
# ---------------------------------------------------------------------------


def _store_text_in_s3(
    text: str, source_bucket: str, source_key: str, inv_id: str
) -> str:
    """
    Store extracted text in S3 alongside the source asset.
    Returns the S3 key of the stored text file.
    """
    if not MEDIA_ASSETS_BUCKET:
        raise ValueError("MEDIA_ASSETS_BUCKET_NAME environment variable not set")

    # Mirror the source key path, replacing the extension with .txt
    base_key = re.sub(r"\.[^.]+$", "", source_key)
    text_key = f"{source_bucket}/{base_key}_extracted_text.txt"

    s3.put_object(
        Bucket=MEDIA_ASSETS_BUCKET,
        Key=text_key,
        Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    logger.info(
        "Stored extracted text in S3",
        extra={"bucket": MEDIA_ASSETS_BUCKET, "key": text_key},
    )
    return text_key


# ---------------------------------------------------------------------------
# Action 1: start extraction
# ---------------------------------------------------------------------------


def _start_extraction(event: Dict[str, Any]) -> Dict[str, Any]:
    """Start an async Textract document analysis job."""
    assets = event.get("payload", {}).get("assets", [])
    if not assets:
        raise ValueError("No assets found in event.payload.assets")

    asset = assets[0]
    inv_raw = asset.get("InventoryID")
    if not inv_raw:
        raise ValueError("Asset missing InventoryID")

    inv_id = clean_asset_id(inv_raw)
    loc = asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
        "PrimaryLocation"
    ]
    bucket = loc["Bucket"]
    key = loc["ObjectKey"]["FullPath"]

    # Read parameters from pipeline configuration
    params = event.get("payload", {}).get("data", {})
    extract_tables = params.get("extract_tables", True)
    extract_forms = params.get("extract_forms", True)

    feature_types: List[str] = []
    if extract_tables:
        feature_types.append("TABLES")
    if extract_forms:
        feature_types.append("FORMS")
    if not feature_types:
        feature_types = ["TABLES", "FORMS"]

    logger.info(
        "Starting Textract analysis",
        extra={
            "inventory_id": inv_id,
            "bucket": bucket,
            "key": key,
            "features": feature_types,
        },
    )

    response = textract.start_document_analysis(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}},
        FeatureTypes=feature_types,
    )

    job_id = response["JobId"]

    logger.info("Textract job started", extra={"job_id": job_id, "inventory_id": inv_id})

    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Textract job started", "jobId": job_id}),
        "externalJobId": job_id,
        "externalJobStatus": "Started",
        "externalJobResult": "Running",
        # Pass through so the status action can find the asset
        "inventory_id": inv_id,
        "source_bucket": bucket,
        "source_key": key,
    }


# ---------------------------------------------------------------------------
# Action 2: check status and collect results
# ---------------------------------------------------------------------------


def _check_status(event: Dict[str, Any]) -> Dict[str, Any]:
    """Poll Textract job status; when complete, parse and store results."""
    metadata = event.get("metadata", {})
    job_id = metadata.get("externalJobId")
    if not job_id:
        # Also check payload.data for job_id passed through pipeline
        job_id = event.get("payload", {}).get("data", {}).get("jobId")
    if not job_id:
        raise ValueError("externalJobId not found in event metadata")

    assets = event.get("payload", {}).get("assets", [])
    if not assets:
        raise ValueError("No assets found in event.payload.assets")

    asset = assets[0]
    inv_raw = asset.get("InventoryID")
    inv_id = clean_asset_id(inv_raw)

    loc = asset["DigitalSourceAsset"]["MainRepresentation"]["StorageInfo"][
        "PrimaryLocation"
    ]
    source_bucket = loc["Bucket"]
    source_key = loc["ObjectKey"]["FullPath"]

    logger.info(
        "Checking Textract job status",
        extra={"job_id": job_id, "inventory_id": inv_id},
    )

    blocks = _paginate_textract_results(job_id)

    # Job still running
    if not blocks:
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "Textract job in progress"}),
            "externalJobId": job_id,
            "externalJobStatus": "inProgress",
            "externalJobResult": "Running",
        }

    # ── parse results ──────────────────────────────────────────────────────
    full_text = _extract_full_text(blocks)
    tables = _extract_tables(blocks)
    forms = _extract_forms(blocks)

    logger.info(
        "Textract results parsed",
        extra={
            "inventory_id": inv_id,
            "text_length": len(full_text),
            "table_count": len(tables),
            "form_field_count": len(forms),
        },
    )

    # ── store raw text in S3 ───────────────────────────────────────────────
    text_s3_key = _store_text_in_s3(full_text, source_bucket, source_key, inv_id)

    # ── build metadata block ───────────────────────────────────────────────
    textract_metadata = _to_decimal(
        {
            "jobId": job_id,
            "textLength": len(full_text),
            "pageCount": max(
                (b.get("Page", 1) for b in blocks if b.get("Page")), default=1
            ),
            "tableCount": len(tables),
            "formFieldCount": len(forms),
            "tables": tables,
            "forms": forms,
            "textS3Bucket": MEDIA_ASSETS_BUCKET,
            "textS3Key": text_s3_key,
        }
    )

    # ── merge with existing EmbeddedMetadata and write to DynamoDB ─────────
    existing = (
        dynamo.get_item(Key={"InventoryID": inv_id})
        .get("Item", {})
        .get("Metadata", {})
        .get("EmbeddedMetadata", {})
    )
    merged = {**existing, "textract": textract_metadata}

    dynamo.update_item(
        Key={"InventoryID": inv_id},
        UpdateExpression="SET #md.#em = :m",
        ExpressionAttributeNames={"#md": "Metadata", "#em": "EmbeddedMetadata"},
        ExpressionAttributeValues={":m": merged},
    )

    updated_item = _strip_decimals(
        dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})
    )

    logger.info("DynamoDB updated with Textract results", extra={"inventory_id": inv_id})

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "Textract extraction complete",
                "textLength": len(full_text),
                "tableCount": len(tables),
                "formFieldCount": len(forms),
                "textS3Bucket": MEDIA_ASSETS_BUCKET,
                "textS3Key": text_s3_key,
            }
        ),
        "externalJobId": job_id,
        "externalJobStatus": "Completed",
        "externalJobResult": "Success",
        # Pass text location downstream for the embedding node
        "textS3Bucket": MEDIA_ASSETS_BUCKET,
        "textS3Key": text_s3_key,
        "updatedAsset": updated_item,
    }


# ---------------------------------------------------------------------------
# Lambda handler — routes to start or status based on event shape
# ---------------------------------------------------------------------------


@lambda_middleware(event_bus_name=os.environ.get("EVENT_BUS_NAME", "default-event-bus"))
@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Route to start extraction or check status depending on whether
    externalJobId is already present in the event metadata.
    """
    metadata = event.get("metadata", {})
    job_id = metadata.get("externalJobId")

    if job_id:
        logger.info("Routing to status check", extra={"job_id": job_id})
        return _check_status(event)
    else:
        logger.info("Routing to extraction start")
        return _start_extraction(event)
