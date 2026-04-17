"""
Amazon Bedrock Titan Embeddings search provider for PDF document semantic search.

Uses amazon.titan-embed-text-v2:0 to generate query embeddings and searches
the 'asset-embeddings' OpenSearch index where pdf_embedding node stores
document chunk vectors.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional

import boto3
from opensearchpy import (
    NotFoundError,
    OpenSearch,
    RequestError,
    RequestsAWSV4SignerAuth,
    RequestsHttpConnection,
)
from unified_search_models import (
    MediaType,
    ProviderLocation,
    SearchArchitectureType,
    SearchHit,
    SearchQuery,
    SearchResult,
)
from unified_search_provider import ProviderPlusStoreSearchProvider

TITAN_MODEL_ID = "amazon.titan-embed-text-v2:0"
TITAN_DIMENSION = 1024
EMBEDDING_FIELD = f"embedding_{TITAN_DIMENSION}_cosine"

class TitanBedrockSearchProvider(ProviderPlusStoreSearchProvider):
    """
    Search provider that uses Amazon Bedrock Titan Embeddings v2 to perform
    semantic search over PDF document chunks stored in the asset-embeddings index.
    """

    def __init__(self, config, logger, metrics):
        super().__init__(config, logger, metrics)

        self._opensearch_client: Optional[OpenSearch] = None
        self._bedrock_client = boto3.client("bedrock-runtime")

        # DynamoDB for enriching results with full asset records
        _dynamodb = boto3.resource("dynamodb")
        _asset_table_name = os.environ.get("MEDIALAKE_ASSET_TABLE", "")
        self._asset_table = _dynamodb.Table(_asset_table_name) if _asset_table_name else None

        self._target_index = getattr(config, "target_index", None) or os.environ.get(
            "ASSET_EMBEDDINGS_INDEX", "asset-embeddings"
        )

        self.logger.info(
            f"[TITAN] Initialized TitanBedrockSearchProvider, "
            f"index='{self._target_index}', model='{TITAN_MODEL_ID}'"
        )

    # ------------------------------------------------------------------
    # BaseSearchProvider interface
    # ------------------------------------------------------------------

    def _get_architecture_type(self) -> SearchArchitectureType:
        return SearchArchitectureType.PROVIDER_PLUS_STORE

    def _get_provider_location(self) -> ProviderLocation:
        return ProviderLocation.INTERNAL

    def _get_supported_media_types(self) -> List[MediaType]:
        # Titan text embeddings only make sense for document content
        return [MediaType("document")]

    def is_available(self) -> bool:
        required = ["OPENSEARCH_ENDPOINT", "AWS_REGION", "SCOPE"]
        return all(os.environ.get(v) for v in required)

    # ------------------------------------------------------------------
    # ProviderPlusStoreSearchProvider interface
    # ------------------------------------------------------------------

    def generate_embeddings(self, query_text: str) -> List[float]:
        """Generate a 1024-D embedding for the query text using Titan v2."""
        body = json.dumps(
            {
                "inputText": query_text,
                "dimensions": TITAN_DIMENSION,
                "normalize": True,
            }
        )
        response = self._bedrock_client.invoke_model(
            modelId=TITAN_MODEL_ID,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read())
        return result["embedding"]

    def get_allowed_clip_embedding_types(self, search_modes=None) -> List[str]:
        # Documents don't have clips — return empty list
        return []

    def execute_store_search(
        self, embeddings: List[float], query: SearchQuery
    ) -> SearchResult:
        """Search the asset-embeddings index using the Titan query vector."""
        client = self._get_opensearch_client()
        start = time.time()

        os_query = self._build_knn_query(embeddings, query)

        try:
            response = client.search(body=os_query, index=self._target_index)
        except (NotFoundError, RequestError) as exc:
            self.logger.warning(f"[TITAN] OpenSearch error: {exc}")
            return SearchResult(
                hits=[],
                total_results=0,
                max_score=0.0,
                took_ms=int((time.time() - start) * 1000),
                provider="titan_bedrock",
                architecture_type=SearchArchitectureType.PROVIDER_PLUS_STORE,
                provider_location=ProviderLocation.INTERNAL,
            )

        hits = self._map_hits(response, query.page_size)
        total = response["hits"]["total"]["value"]
        max_score = response["hits"].get("max_score") or 0.0

        self.logger.info(
            f"[TITAN] Search returned {len(hits)} hits "
            f"(total={total}, max_score={max_score:.4f})"
        )

        return SearchResult(
            hits=hits,
            total_results=min(total, len(hits)),
            max_score=max_score,
            took_ms=int((time.time() - start) * 1000),
            provider="titan_bedrock",
            architecture_type=SearchArchitectureType.PROVIDER_PLUS_STORE,
            provider_location=ProviderLocation.INTERNAL,
        )

    def search(self, query: SearchQuery) -> SearchResult:
        """Full search pipeline: embed query → KNN search → return hits."""
        self.logger.info(f"[TITAN] Semantic search for: '{query.query_text}'")
        embeddings = self.generate_embeddings(query.query_text)
        return self.execute_store_search(embeddings, query)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_opensearch_client(self) -> OpenSearch:
        if self._opensearch_client is None:
            host = os.environ["OPENSEARCH_ENDPOINT"].replace("https://", "")
            region = os.environ["AWS_REGION"]
            scope = os.environ["SCOPE"]
            auth = RequestsAWSV4SignerAuth(
                boto3.Session().get_credentials(), region, scope
            )
            self._opensearch_client = OpenSearch(
                hosts=[{"host": host, "port": 443}],
                http_auth=auth,
                use_ssl=True,
                verify_certs=True,
                connection_class=RequestsHttpConnection,
                region=region,
                timeout=30,
                max_retries=2,
                retry_on_timeout=True,
                maxsize=10,
            )
        return self._opensearch_client

    def _build_knn_query(
        self, embedding: List[float], query: SearchQuery
    ) -> Dict[str, Any]:
        """Build an OpenSearch KNN query filtered to document chunks."""
        filters: List[Dict] = [
            # Only match document-type embeddings written by pdf_embedding node
            {"term": {"embedding_type": "document"}}
        ]

        # Optional: filter by specific asset IDs if provided in query filters
        if query.filters:
            for f in query.filters:
                field = f.get("field") or f.get("key", "")
                if field in ("DigitalSourceAsset.Type", "mediaType"):
                    pass  # already filtered by embedding_type above

        return {
            "size": query.page_size * 3,  # over-fetch to deduplicate by asset
            "query": {
                "bool": {
                    "must": [
                        {
                            "knn": {
                                EMBEDDING_FIELD: {
                                    "vector": embedding,
                                    "k": query.page_size * 3,
                                }
                            }
                        }
                    ],
                    "filter": filters,
                }
            },
            "_source": {
                "excludes": [EMBEDDING_FIELD]  # don't return the vector itself
            },
        }

    def _map_hits(self, response: Dict[str, Any], page_size: int) -> List[SearchHit]:
        """
        Convert OpenSearch hits to SearchHit objects.

        Deduplicates by inventory_id (best chunk per asset), then enriches
        each result with the full asset record from DynamoDB so the frontend
        receives the same structure as image/video/audio search results.
        """
        seen: Dict[str, float] = {}
        best_hit: Dict[str, Any] = {}

        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            inv_id = source.get("inventory_id", "")
            score = hit.get("_score", 0.0) or 0.0

            if inv_id and score > seen.get(inv_id, -1):
                seen[inv_id] = score
                best_hit[inv_id] = hit

        # Sort by score and cap at page_size
        sorted_ids = sorted(seen, key=lambda k: seen[k], reverse=True)[:page_size]

        result: List[SearchHit] = []
        for inv_id in sorted_ids:
            # Enrich with full asset record from DynamoDB
            asset_record = self._fetch_asset(inv_id)
            if asset_record:
                source = asset_record
            else:
                # Fallback: minimal record so the frontend doesn't crash
                source = {"InventoryID": inv_id}

            result.append(
                SearchHit(
                    asset_id=inv_id,
                    score=seen[inv_id],
                    source=source,
                    media_type=MediaType.DOCUMENT,
                )
            )

        return result

    def _fetch_asset(self, inventory_id: str) -> Optional[Dict[str, Any]]:
        """Fetch the full asset record from DynamoDB."""
        if not self._asset_table:
            return None
        try:
            resp = self._asset_table.get_item(Key={"InventoryID": inventory_id})
            return resp.get("Item")
        except Exception as exc:
            self.logger.warning(f"[TITAN] DynamoDB fetch failed for {inventory_id}: {exc}")
            return None
