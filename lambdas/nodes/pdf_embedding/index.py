"""
PDF Embedding Node

Reads the extracted text file written by pdf_text_extractor from S3,
chunks it into segments of at most `chunk_size` characters with `chunk_overlap`
overlap, generates a semantic embedding for each chunk using Amazon Bedrock
Titan Embeddings v2 (amazon.titan-embed-text-v2:0), and indexes each chunk
as a separate document in the OpenSearch `asset-embeddings` index.

The document schema mirrors the one used by the existing embedding_store node
so that PDF embeddings are queryable alongside video/audio/image embeddings.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext
from lambda_middleware import lambda_middleware
from opensearchpy import AWSV4SignerAuth, OpenSearch, RequestsHttpConnection

logger = Logger()
tracer = Tracer()

s3 = boto3.client("s3")
bedrock = boto3.client("bedrock-runtime")
dynamo = boto3.resource("dynamodb").Table(os.environ["MEDIALAKE_ASSET_TABLE"])

OPENSEARCH_ENDPOINT = os.getenv("OPENSEARCH_ENDPOINT", "")
ASSET_EMBEDDINGS_INDEX = os.getenv("ASSET_EMBEDDINGS_INDEX", "asset-embeddings")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
TITAN_MODEL_ID = "amazon.titan-embed-text-v2:0"
TITAN_DIMENSION = 1024  # Titan Embeddings v2 default output dimension

# ---------------------------------------------------------------------------
# OpenSearch client (lazy init)
# ---------------------------------------------------------------------------

_os_client: Optional[OpenSearch] = None


def _get_os_client() -> Optional[OpenSearch]:
    global _os_client
    if _os_client is not None:
        return _os_client
    if not OPENSEARCH_ENDPOINT:
        logger.warning("OPENSEARCH_ENDPOINT not set – skipping OpenSearch indexing")
        return None
    session = boto3.Session()
    credentials = session.get_credentials()
    auth = AWSV4SignerAuth(credentials, AWS_REGION, "es")
    host = OPENSEARCH_ENDPOINT.split("://")[-1]
    _os_client = OpenSearch(
        hosts=[{"host": host, "port": 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=60,
        http_compress=True,
        retry_on_timeout=True,
        max_retries=3,
    )
    return _os_client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def clean_asset_id(raw: str) -> str:
    parts = raw.split(":")
    uuid_part = parts[-1] if parts[-1] != "master" else parts[-2]
    return f"asset:uuid:{uuid_part}"


def _strip_decimals(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _strip_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_decimals(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Text chunking
# ---------------------------------------------------------------------------


def chunk_text(text: str, chunk_size: int = 8000, overlap: int = 200) -> List[str]:
    """
    Split text into chunks of at most `chunk_size` characters with `overlap`
    character overlap between consecutive chunks.

    Tries to split on sentence boundaries ('. ') to avoid cutting mid-sentence.
    Falls back to hard splits when no boundary is found within the window.
    """
    if not text:
        return []

    chunks: List[str] = []
    start = 0

    while start < len(text):
        end = min(start + chunk_size, len(text))

        if end < len(text):
            # Try to find a sentence boundary near the end of the window
            boundary = text.rfind(". ", start, end)
            if boundary != -1 and boundary > start + chunk_size // 2:
                end = boundary + 1  # include the period

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        # Advance start, stepping back by overlap to maintain context
        start = end - overlap if end - overlap > start else end

    return chunks


# ---------------------------------------------------------------------------
# Bedrock embedding
# ---------------------------------------------------------------------------


def _embed_text(text: str) -> List[float]:
    """Call Titan Embeddings v2 and return the embedding vector."""
    body = json.dumps(
        {
            "inputText": text,
            "dimensions": TITAN_DIMENSION,
            "normalize": True,
        }
    )
    response = bedrock.invoke_model(
        modelId=TITAN_MODEL_ID,
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    result = json.loads(response["body"].read())
    return result["embedding"]


# ---------------------------------------------------------------------------
# OpenSearch indexing
# ---------------------------------------------------------------------------


def _index_chunk(
    client: OpenSearch,
    inventory_id: str,
    chunk_index: int,
    chunk_text: str,
    embedding: List[float],
) -> None:
    """Index a single text chunk with its embedding as a separate document."""
    field_name = f"embedding_{TITAN_DIMENSION}_cosine"

    doc = {
        "inventory_id": inventory_id,
        "embedding_type": "document",
        "model_provider": "amazon",
        "inference_provider": "aws_bedrock",
        "model_name": "titan-embed-text",
        "model_version": "v2",
        "created_at": datetime.utcnow().isoformat(),
        "embedding_granularity": "segment",
        "segmentation_method": "fixed_size",
        "embedding_representation": "text",
        "embedding_dimension": TITAN_DIMENSION,
        "space_type": "cosinesimil",
        "chunk_index": chunk_index,
        "chunk_text": chunk_text[:500],  # store a preview for debugging
        "start_seconds": 0,
        "end_seconds": None,
        "start_smpte_timecode": "00:00:00:00",
        "end_smpte_timecode": None,
        field_name: embedding,
    }

    doc_id = f"{inventory_id}:pdf:chunk:{chunk_index}"
    client.index(index=ASSET_EMBEDDINGS_INDEX, id=doc_id, body=doc)


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
        raise ValueError("Asset missing InventoryID")
    inv_id = clean_asset_id(inv_raw)

    # ── locate the extracted text file ────────────────────────────────────
    # The pdf_text_extractor node stores textS3Bucket / textS3Key in the
    # event body. Fall back to looking in EmbeddedMetadata if not present.
    payload_data = event.get("payload", {}).get("data", {})

    text_bucket: Optional[str] = None
    text_key: Optional[str] = None

    # Try direct fields first (passed through pipeline)
    if isinstance(payload_data, dict):
        body_raw = payload_data.get("body")
        if isinstance(body_raw, str):
            try:
                body_parsed = json.loads(body_raw)
                text_bucket = body_parsed.get("textS3Bucket")
                text_key = body_parsed.get("textS3Key")
            except (json.JSONDecodeError, AttributeError):
                pass
        if not text_key:
            text_bucket = payload_data.get("textS3Bucket")
            text_key = payload_data.get("textS3Key")

    # Fall back to DynamoDB EmbeddedMetadata
    if not text_key:
        item = dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})
        textract_meta = (
            item.get("Metadata", {}).get("EmbeddedMetadata", {}).get("textract", {})
        )
        text_bucket = str(textract_meta.get("textS3Bucket", ""))
        text_key = str(textract_meta.get("textS3Key", ""))

    if not text_key or not text_bucket:
        raise ValueError(
            f"Cannot locate extracted text for asset {inv_id}. "
            "Ensure pdf_text_extractor ran successfully before this node."
        )

    # ── read parameters ────────────────────────────────────────────────────
    chunk_size = int(payload_data.get("chunk_size", 8000)) if isinstance(payload_data, dict) else 8000
    chunk_overlap = int(payload_data.get("chunk_overlap", 200)) if isinstance(payload_data, dict) else 200
    index_name = payload_data.get("index_name", ASSET_EMBEDDINGS_INDEX) if isinstance(payload_data, dict) else ASSET_EMBEDDINGS_INDEX

    logger.info(
        "Starting PDF embedding",
        extra={
            "inventory_id": inv_id,
            "text_bucket": text_bucket,
            "text_key": text_key,
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
        },
    )

    # ── fetch extracted text ───────────────────────────────────────────────
    text = s3.get_object(Bucket=text_bucket, Key=text_key)["Body"].read().decode("utf-8")

    if not text.strip():
        logger.warning("Extracted text is empty — skipping embedding", extra={"inventory_id": inv_id})
        return {
            "statusCode": 200,
            "body": json.dumps({"message": "No text to embed", "chunksIndexed": 0}),
        }

    # ── chunk text ─────────────────────────────────────────────────────────
    chunks = chunk_text(text, chunk_size=chunk_size, overlap=chunk_overlap)
    logger.info(
        "Text chunked",
        extra={"inventory_id": inv_id, "chunk_count": len(chunks)},
    )

    # ── embed and index each chunk ─────────────────────────────────────────
    os_client = _get_os_client()
    indexed = 0
    errors = 0

    for i, chunk in enumerate(chunks):
        try:
            embedding = _embed_text(chunk)

            if os_client:
                _index_chunk(os_client, inv_id, i, chunk, embedding)
                indexed += 1
            else:
                logger.warning(
                    "OpenSearch unavailable — embedding generated but not stored",
                    extra={"chunk_index": i},
                )

        except Exception as exc:
            errors += 1
            logger.error(
                "Failed to embed/index chunk",
                extra={"chunk_index": i, "error": str(exc)},
            )
            # Continue processing remaining chunks rather than failing the whole job
            continue

    logger.info(
        "PDF embedding complete",
        extra={
            "inventory_id": inv_id,
            "chunks_total": len(chunks),
            "chunks_indexed": indexed,
            "errors": errors,
        },
    )

    if errors > 0 and indexed == 0:
        raise RuntimeError(
            f"All {errors} chunks failed to embed for asset {inv_id}"
        )

    updated_item = _strip_decimals(
        dynamo.get_item(Key={"InventoryID": inv_id}).get("Item", {})
    )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "PDF embedding complete",
                "chunksTotal": len(chunks),
                "chunksIndexed": indexed,
                "errors": errors,
            }
        ),
        "updatedAsset": updated_item,
    }
