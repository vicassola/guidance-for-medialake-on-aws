# Report Architetturale — MediaLake on AWS

*Basato sul knowledge graph Graphify (14.933 nodi · 25.867 edge · 946 community)*  
*Generato: 2026-06-26*

---

## Parte 1 — Domini backend e come si raggruppano

Il backend è interamente serverless su AWS CDK. Il grafo individua **8 domini funzionali distinti**, ciascuno con stack/construct CDK dedicati e Lambda autonome.

---

### 1. Asset Management

**Stack:** `BaseInfrastructureStack`, `AssetSyncStack`, `AssetsConstruct` (API Gateway)  
**Storage:** DynamoDB (`asset_table`), S3 (media originali), OpenSearch (indice full-text + vettoriale)

| Lambda path | Funzione |
|---|---|
| `assets/get_assets` | Lista asset con filtri |
| `assets/rp_assets_id/get_assets` | Dettaglio singolo asset (con clip OpenSearch) |
| `assets/rp_assets_id/del_assets` | Delete singolo |
| `assets/rp_assets_id/rename/post_rename` | Rinomina |
| `assets/rp_assets_id/transcript` | Recupero trascrizione |
| `assets/rp_assets_id/view` | URL presigned per visualizzazione |
| `assets/rp_assets_id/related_versions` | Versioni correlate |
| `assets/generate_presigned_url` | Pre-signed URL S3 |
| `assets/batch_delete/*` | Delete massiva asincrona (aggregator → processor) |
| `assets/download/bulk/*` | Download bulk con job tracking (multipart ZIP) |
| `assets/upload/*` | Upload multipart S3 (initiate/sign/complete/abort) |

**Flusso ingest:** `S3 trigger → lambdas/ingest/s3 → asset_table_stream → back_end/pipeline_nodes_deployment → NodesStack`

---

### 2. Pipeline Engine

**Stack:** `PipelinesExecutionsStack`, `ApiGatewayPipelinesConstruct`  
**Storage:** DynamoDB (definizioni pipeline + executions), Step Functions (orchestrazione)  
**Modello dati core** (`post_pipelines/models.py`):

```python
PipelineDefinition {
    nodes: [Node],
    edges: [Edge],
    settings: Settings,
    configuration: Configuration
}
```

| Lambda path | Funzione |
|---|---|
| `pipelines/post_pipelines` | Crea pipeline (sync) |
| `pipelines/post_pipelines_async` | Crea pipeline (async + Step Function) |
| `pipelines/del_pipelinesid` | Elimina pipeline |
| `pipelines/pipeline_trigger` | Trigger manuale/API/event |
| `back_end/pipelines_executions_event_processor` | Processa eventi esecuzione |

**Nodi pipeline (`lambdas/nodes/`)** — 20+ nodi pluggabili, ognuno una Lambda autonoma:

| Nodo | Categoria |
|---|---|
| `image_metadata_extractor`, `video_metadata_extractor`, `audio_metadata_extractor`, `pdf_metadata_extractor` | Estrazione metadata |
| `image_thumbnail`, `video_proxy_and_thumbnail`, `audio_thumbnail`, `pdf_thumbnail` | Proxy e thumbnail |
| `audio_transcription_transcribe`, `audio_transcription_transcribe_status` | Trascrizione |
| `bedrock_content_processor`, `twelvelabs_bedrock_invoke/status/results` | AI / LLM |
| `image_rekognition_labels` | Computer vision |
| `embedding_store`, `s3_vector_store`, `pdf_embedding` | Store vettoriale |
| `external_metadata_fetch`, `filename_tagger`, `publish_event` | Utility |
| `webhook_ingress`, `pre_signed_url` | I/O |
| `image_proxy`, `audio_proxy`, `video_splitter`, `audio_splitter`, `pdf_text_extractor` | Trasformazione |

---

### 3. Search Engine

**Stack:** `SearchConstruct` (API Gateway)  
**Storage:** OpenSearch Managed Cluster + S3 Vectors Cluster  
**Architettura:** Pattern Strategy con `BaseEmbeddingStore` (ABC) → due implementazioni:

- `OpenSearchEmbeddingStore` — keyword + vettoriale su OS managed
- `S3VectorEmbeddingStore` — vettoriale su S3 Vectors (AWS native)

**Provider AI:** Bedrock (embedding testo), TwelveLabs (video semantic search, modello `marengo-3.0`)  
**Factory:** `EmbeddingStoreFactory` seleziona l'implementazione da system settings

| Lambda path | Funzione |
|---|---|
| `search/get_search` | Ricerca full-text + semantic con facet (type, extension, date, size) |
| `search/connectors` | Lista connettori disponibili per filtrare |

---

### 4. Collections API

**Stack:** `CollectionsApi`, community *Search & Collections Core*  
**Storage:** DynamoDB, OpenSearch (per `fetch_assets_from_opensearch`, `get_all_clips_for_asset`)

| Lambda path | Funzione |
|---|---|
| `collections_api` | CRUD collezioni, tipi, condivisione, membership, gruppi |

Operazioni esposte: `BASE / GET / UPDATE / DELETE / ANCESTORS / SHARE / UNSHARE / ITEMS / GROUPS / MOVE / COPY / GROUP_ITEMS / COLLECTION_TYPES / USERS`

---

### 5. Connectors & Environments

**Stack:** `ConnectorsConstruct`, `ApiGatewayEnvironmentsConstruct`, `IntegrationsEnvironmentStack`

| Lambda path | Funzione |
|---|---|
| `connectors/get_connectors` | Lista connettori |
| `connectors/del_connectors` | Delete connettore |
| `connectors/rp_connectorId/del_connectorId` | Delete per ID |
| `connectors/rp_connectorId/sync/post_sync` | Trigger sync manuale |
| `connectors/s3/get_s3`, `post_s3` | CRUD connettore S3 |
| `connectors/s3/buckets/get_buckets` | Lista bucket S3 |
| `connectors/s3/explorer/rp_connector_id` | Esplora albero S3 |
| `environments/get_environments`, `post_environments` | CRUD ambienti |
| `environments/rp_environmentsId/put_environmentsId` | Update ambiente |
| `environments/rp_environmentsId/del_environmentsId` | Delete ambiente |

---

### 6. Authorization & User Management

**Stack:** `CognitoStack`, `UsersGroupsStack`, `AuthorizationStack`  
**Infrastruttura:** Cognito User Pool, Lambda custom authorizer, policy sync DynamoDB

| Lambda path | Funzione |
|---|---|
| `authorization/assignments/assign_ps_to_group` | Assegna permission set a gruppo |
| `authorization/assignments/assign_ps_to_user` | Assegna permission set a utente |
| `authorization/assignments/list_group_assignments` | Lista assegnazioni gruppo |
| `authorization/assignments/list_user_assignments` | Lista assegnazioni utente |
| `authorization/assignments/remove_group_assignment` | Rimuovi assegnazione gruppo |
| `authorization/assignments/remove_user_assignment` | Rimuovi assegnazione utente |
| `authorization/permission_sets/post_permission_sets` | Crea permission set |
| `authorization/permission_sets/put_permission_sets` | Aggiorna permission set |
| `authorization/permission_sets/del_permission_sets` | Elimina permission set |
| `groups_unified` | CRUD gruppi, membership |
| `roles` (`api_gateway_roles.py`) | CRUD ruoli |
| `auth/custom_authorizer` | JWT validation + CASL policy lookup |
| `auth/policy_sync` | Sincronizza policy Cognito → DynamoDB |
| `auth/auth_seeder` | Seed gruppi/utenti iniziali al deploy |
| `settings/users`, `settings/roles` | Gestione utenti e ruoli |

---

### 7. Integrations & Settings

**Stack:** `ApiGatewayIntegrationsConstruct`, `SettingsStack`

| Lambda path | Funzione |
|---|---|
| `integrations` / `integrations_api` | CRUD integrazioni (webhook, provider AI) |
| `settings/system` | System settings (search provider, feature flags) |
| `dashboard_api` | Layout dashboard, preset, widget config |
| `nodes` (API handler) | Registry nodi pipeline disponibili |
| `aws/get_regions` | Lista regioni AWS |
| `health/get_health` | Health check endpoint |
| `reviews` | Showcase/review feature (admin only) |
| `storage` | Storage management |
| `updates` / `updates/index` | Notifiche aggiornamenti job |

---

### 8. Background Workers (non-API)

Lambda senza endpoint REST che orchestrano flussi asincroni:

| Lambda | Trigger | Funzione |
|---|---|---|
| `back_end/asset_sync/engine` | EventBridge | Motore sync asset |
| `back_end/asset_sync/job_event_processor` | EventBridge | Processa eventi job sync |
| `back_end/asset_sync/job_status` | EventBridge | Aggiorna stato job |
| `back_end/asset_sync/processor` | SQS | Processa batch asset |
| `back_end/asset_table_stream` | DynamoDB Stream | Processa cambiamenti tabella asset |
| `back_end/asset_table_stream_dlq_processor` | SQS DLQ | Retry messaggi falliti |
| `back_end/asset_table_ingestion_pipeline` | Step Function | Pipeline di ingestione |
| `back_end/create_os_index` | Custom Resource (deploy) | Crea indici OpenSearch |
| `back_end/populate_system_settings` | Custom Resource (deploy) | Seed settings di sistema |
| `back_end/pipeline_nodes_deployment` | Deploy | Registra nodi nel registry |
| `back_end/pre_deploy_cleanup` | Deploy | Cleanup pre-deploy |
| `back_end/provisioned_resource_cleanup` | Deploy | Cleanup risorse provisionate |
| `lambdas/ingest/s3` | S3 Event Notification | Entry point ingestione file da S3 |
| `lambdas/edge/csp_header_modifier` | CloudFront Lambda@Edge | Aggiunge CSP headers alle risposte |
| `lambdas/pipelines/pipeline_trigger` | EventBridge / API | Trigger pipeline da eventi S3/API |

---

## Parte 2 — Pagine/Route del frontend e dati richiesti

Il frontend usa **React Query** (`useQuery` / `useMutation`) con `ApiClient` centralizzato (`src/api/apiClient.ts`). I dati fluiscono da `API_ENDPOINTS` → hook React Query → store Zustand (per search/dashboard) → componenti.

---

### `/` — Home / Dashboard

**Componenti:** `DashboardGrid`, `ExpandedWidgetModal`, `DashboardSelector`, widget (`RecentAssetsWidget`, etc.)

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useDashboardSync` | `GET/PUT /dashboard/layout` |
| `useDashboardPresets` | `GET /dashboard/presets` |
| `useGetFavorites()` | `GET /users/favorites` |
| `useSearch` (RecentAssetsWidget) | `GET /search` (sort temporale) |
| `useSemanticSearchStatus` | `GET /settings/system/search` |

**Dati necessari:** layout dashboard (griglia widget + posizioni), preset disponibili, asset recenti (ultimi visualizzati), asset preferiti, system settings (feature flags, provider semantico attivo)

---

### `/search` — Ricerca

**Componenti:** `SearchPage`, `MasterResultsView`, `SearchFilters`, `FilterPanel`, `ActiveFiltersBar`, `AssetGridView` / `AssetTableView`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useSearch` | `GET /search?q=...&semantic=...&type=...&extension=...&ingested_date_gte=...` |
| `useSearchConnectors` | `GET /search/connectors` |
| `useSemanticSearchStatus` | `GET /settings/system/search` |
| `useGetFavorites` | `GET /users/favorites` |
| `useAssetOperations` | `DELETE /assets/{id}`, `POST /assets/{id}/rename` |
| `useAddItemToCollection` | `POST /collections/{id}/items` |

**Store:** `searchStore` (Zustand) — query, filtri attivi, modalità semantica, draft filtri

**Dati necessari:** risultati ricerca con facet (`type`, `extension`, `date`, `size`), lista connettori filtrabili, configurazione semantic search (provider, modello, soglie di confidenza), stato preferiti per asset in lista

---

### `/assets` — Asset Explorer

**Componenti:** `AssetsPage`, `AssetExplorer`, pannello connettori laterale collassabile

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useSearchConnectors` | `GET /search/connectors` |
| `useAssets` | `GET /assets?connector_id=...` |
| `useAssetOperations` | `DELETE /assets/{id}`, `POST /assets/{id}/rename` |
| `useAssetFavorites` | `GET/POST/DELETE /users/favorites` |

**Dati necessari:** lista connettori (nome, tipo, stato sync), albero asset per connettore selezionato (con paginazione), permessi utente per operazioni

---

### `/images/:id`, `/videos/:id`, `/audio/:id`, `/documents/:id` — Dettaglio Asset

**Componenti:** `ImageDetailPage` / `MediaDetailPage`, `AssetSidebar`, `AssetMetadataTabs`, player video/audio (Omakase)

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useAsset` | `GET /assets/{id}` |
| `useAssetView` | `GET /assets/{id}/view` (presigned URL streaming) |
| `useTranscript` | `GET /assets/{id}/transcript` |
| `useRelatedVersions` | `GET /assets/{id}/related_versions` |
| `useAddItemToCollection` | `POST /collections/{id}/items` |
| `useAssetFavorites` | `GET/POST/DELETE /users/favorites` |
| `useAssetOperations` | `DELETE /assets/{id}`, `POST /assets/{id}/rename` |

**Dati necessari:** metadata tecnici (codec, risoluzione, durata, dimensione, EXIF, ICC profile), metadata descrittivi AI (labels Rekognition, trascrizione, summary Bedrock, embedding clip), URL presigned streaming, versioni correlate, clip temporali OpenSearch, collezioni di appartenenza

---

### `/collections` — Lista Collezioni

**Componenti:** `CollectionsPage`, `CollectionCard`, filter per tipo, `CollectionGroupDetailPage`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useCollections` | `GET /collections` |
| `useCollectionTypes` | `GET /collections/collection-types` |
| `useCreateCollection` | `POST /collections` |
| `useDeleteCollection` | `DELETE /collections/{id}` |

**Dati necessari:** lista collezioni (nome, tipo, conteggio item, thumbnail, data modifica, condivisione), lista tipi collezione disponibili, permessi CASL per create/edit/delete

---

### `/collections/:id/view` — Vista Collezione

**Componenti:** `CollectionViewPage`, `AssetGridView` / `AssetTableView`, breadcrumb gerarchico

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useCollection` | `GET /collections/{id}` |
| `useCollectionAncestors` | `GET /collections/{id}/ancestors` |
| `useCollectionItems` | `GET /collections/{id}/items` |
| `useShareCollection` | `POST /collections/{id}/share` |

**Dati necessari:** metadata collezione, path gerarchico (breadcrumb), asset contenuti con paginazione, utenti con cui è condivisa

---

### `/pipelines` — Lista Pipeline

**Componenti:** `PipelinesPage`, `PipelineTable`, `TriggerTypeChips`, `PipelineStatusCell`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useGetPipelines()` | `GET /pipelines` |
| `useUpdatePipeline()` | `PUT /pipelines/{id}` |
| `useDeletePipeline()` | `DELETE /pipelines/{id}` |
| `useTriggerPipeline()` | `POST /pipelines/{id}/trigger` |

**Dati necessari:** lista pipeline con `{ id, name, status, triggerTypes, eventRules, nodeCount, lastExecution, createdAt }`, stato in real-time per esecuzioni attive

---

### `/pipelines/new` e `/settings/pipelines/edit/:id` — Pipeline Editor

**Componenti:** `PipelineEditorPage`, `NodeConfigurationForm`, `PipelineEditor` (ReactFlow/xyflow)

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useGetNodes` | `GET /nodes` (registry nodi disponibili) |
| `usePipelineManager` | `GET /pipelines/{id}` (edit), `POST /pipelines`, `PUT /pipelines/{id}` |
| `useGetIntegrations` | `GET /integrations` (validazione trigger) |
| `integrationValidation.service` | validazione locale schema nodi |

**Dati necessari:** catalogo nodi pipeline (tipo, icona, input schema, output schema, configurazione richiesta, versione), definizione pipeline esistente per edit (nodi + edge + settings), lista integrazioni per event trigger (webhook URL, EventBridge rule ARN)

---

### `/executions` — Pipeline Executions

**Componenti:** `ExecutionsPage`, `ExecutionList`, `ExecutionDetail`, `ExecutionMonitor`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useExecutions` | `GET /pipelines/executions` |
| `useRetryExecution` | `POST /pipelines/executions/{id}/retry?type=from_start\|from_current` |
| `useJobNotifications` | polling `GET /updates` o WebSocket |

**Dati necessari:** lista esecuzioni con `{ pipelineId, pipelineName, status, startTime, endTime, duration, nodes: [{id, status, error}] }`, real-time status update tramite polling/notify

---

### `/settings/profile` — Profilo Utente

**Componenti:** `ProfilePage`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `fetchUserAttributes` | Cognito SDK |
| `useApiKeys` | `GET /settings/api-keys` |
| `useCreateApiKey` | `POST /settings/api-keys` |
| `useDeleteApiKey` | `DELETE /settings/api-keys/{id}` |

**Dati necessari:** attributi utente Cognito (nome, email, gruppo), lista API keys personali con permessi

---

### `/settings/connectors` — Connettori

**Componenti:** `ConnectorsPage`, `ConnectorCard`, `ConnectorModal`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useConnectors` | `GET /connectors` |
| `useCreateConnector` | `POST /connectors/s3` |
| `useDeleteConnector` | `DELETE /connectors/{id}` |
| `useSyncConnector` | `POST /connectors/{id}/sync` |
| `useS3Buckets` | `GET /connectors/s3/buckets` |

**Dati necessari:** lista connettori (nome, tipo S3, bucket, regione, stato sync, ultimo sync), lista bucket S3 accessibili per configurazione

---

### `/settings/users` — User Management

**Componenti:** `UserManagement`, `UserList`, `UserTableToolbar`, `ManageGroupsModal`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useUsers` | `GET /settings/users` |
| `useEnableUser` | `PUT /users/{id}/enable` |
| `useDisableUser` | `PUT /users/{id}/disable` |
| `useGroups` | `GET /groups` |
| `useManageGroupMembers` | `POST/DELETE /groups/{id}/members` |

**Dati necessari:** lista utenti (username, email, status, gruppi), lista gruppi disponibili

---

### `/settings/roles` — Role Management

**Componenti:** `RoleManagement`, `RoleList`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useRoles` | `GET /settings/roles` |
| `useCreateRole` | `POST /settings/roles` |
| `useUpdateRole` | `PUT /settings/roles/{id}` |
| `useDeleteRole` | `DELETE /settings/roles/{id}` |

**Dati necessari:** lista ruoli/permission sets con definizione permessi CASL

---

### `/settings/permissions` — Permissions

**Componenti:** `PermissionsPage`, `GroupSelector`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useGroupPermissions` | `GET /groups/{id}/permissions` |
| `useUpdateGroupPermissions` | `PUT /groups/{id}/permissions` |
| `usePermissionSets` | `GET /authorization/permission_sets` |

**Dati necessari:** matrice permessi per gruppo, lista permission sets assegnabili

---

### `/settings/integrations` — Integrazioni

**Componenti:** `IntegrationsPage`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useIntegrations` | `GET /integrations` |
| `useCreateIntegration` | `POST /integrations` |
| `useUpdateIntegration` | `PUT /integrations/{id}` |
| `useDeleteIntegration` | `DELETE /integrations/{id}` |

**Dati necessari:** lista integrazioni (tipo, nome, webhook URL, API key, stato, pipeline trigger associati)

---

### `/settings/system` — System Settings

**Componenti:** `SystemSettingsPage`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useSystemSettings` | `GET /settings/system` |
| `useUpdateSearchSettings` | `PUT /settings/system/search` |

**Dati necessari:** configurazione search provider (OpenSearch vs S3 Vectors), TwelveLabs API config (endpoint, model), feature flags, soglie confidence AI

---

### `/settings/environments` — Environments

**Componenti:** `EnvironmentsPage`, `EnvironmentList`

**Hook / API chiamate:**

| Hook | Endpoint |
|---|---|
| `useEnvironments` | `GET /environments` |
| `useCreateEnvironment` | `POST /environments` |
| `useUpdateEnvironment` | `PUT /environments/{id}` |
| `useDeleteEnvironment` | `DELETE /environments/{id}` |

**Dati necessari:** lista ambienti deployment (nome, regione, variabili, stato)

---

## Mappa bridge frontend ↔ backend

```
Pagina                  Dominio API             Storage principale
─────────────────────────────────────────────────────────────────────
/                       Dashboard API           DynamoDB (layouts)
/search                 Search Lambda           OpenSearch + DynamoDB
/assets                 Connectors + Assets     DynamoDB + S3
/images|videos|audio/:id  Assets Lambda         DynamoDB + OpenSearch + S3
/collections            Collections API         DynamoDB + OpenSearch
/pipelines              Pipelines Lambda        DynamoDB + Step Functions
/pipelines/new          Nodes API + Pipelines   DynamoDB
/executions             Pipelines Executions    DynamoDB + EventBridge
/settings/profile       Cognito SDK             Cognito
/settings/connectors    Connectors Lambda       DynamoDB
/settings/users         Auth Lambda + Cognito   Cognito + DynamoDB
/settings/roles         Roles API               DynamoDB
/settings/permissions   Authorization Lambda    DynamoDB
/settings/integrations  Integrations Lambda     DynamoDB
/settings/system        Settings Lambda         DynamoDB
/settings/environments  Environments Lambda     DynamoDB
```

---

## Note architetturali critiche

**Single Point of Coupling — OpenSearch:** Quasi ogni dominio dipende da OpenSearch in lettura:
- Search usa OS come indice principale
- Asset detail recupera clip temporali da OS (`get_all_clips_for_asset`)
- Collections filtra asset tramite OS (`fetch_assets_from_opensearch`)
- Dashboard widget `RecentAssets` esegue ricerche su OS

Un degradamento dell'indice OpenSearch impatta simultaneamente Search, Asset Detail, Collections e Dashboard.

**Dual write pattern su ingestione:** Ogni asset ingestito da S3 viene scritto sia su DynamoDB (record primario) che su OpenSearch (indice ricercabile) tramite `asset_table_stream`. I due store possono divergere in caso di errori nel DLQ processor (`asset_table_stream_dlq_processor`).

**Pipeline Nodes come microservizi:** Ogni nodo pipeline (`lambdas/nodes/*`) è una Lambda indipendente con schema I/O proprio. Il frontend `NodeConfigurationForm` dipende dal registry `/nodes` che espone questi schemi — aggiungere un nodo backend richiede un aggiornamento del registry per essere selezionabile nell'editor.

**Semantic search feature-flagged:** La modalità semantica è condizionata da `settings/system/search` che il frontend legge con `useSemanticSearchStatus`. Se il provider non è configurato, il toggle semantico apre un dialog di configurazione invece di eseguire la ricerca.

---

## Componenti shared e blast radius

**Libreria UI base:** Material-UI (MUI) v7.3.0 + AWS Amplify UI (autenticazione) + Emotion (styling)

### Shared components critici (usati in 3+ pagine)

| Componente | Path | Pagine che lo usano | Props principali (interfaccia) | Fonte dati |
|---|---|---|---|---|
| `AssetResultsView` | `components/shared/AssetResultsView.tsx` | SearchPage, AssetsPage, CollectionViewPage | `results`, `searchMetadata: {totalResults, page, pageSize}`, `viewMode`, `sorting`, `columns`, `onPageChange` | Props |
| `AssetTable` | `components/shared/AssetTable.tsx` | SearchPage, AssetsPage, MediaDetailPage, ImageDetailPage, CollectionViewPage, ShowcasePage (6+) | `data`, `columns`, `sorting`, `onSortingChange`, `onDeleteClick`, `onAssetClick`, `getThumbnailUrl`, `getName`, `getId` | Props (@tanstack/react-table interno) |
| `AssetGridView` | `components/shared/AssetGridView.tsx` | SearchPage, AssetsPage, MediaDetailPage, ImageDetailPage, CollectionViewPage, ShowcasePage (6+) | `results`, `groupByType`, `cardSize: "small"\|"medium"\|"large"`, `aspectRatio`, `thumbnailScale`, `showMetadata`, `cardFields` | Props + Context (`AssetItemContext`) |
| `AssetCard` | `components/shared/AssetCard/AssetCard.tsx` | Transitivo via AssetGridView (tutte le pagine asset) | `id`, `name`, `thumbnailUrl`, `assetType`, `clips`, `fields`, `onAssetClick`, `onDeleteClick`, `onDownloadClick`, `isFavorite`, `isSelected`, `isSemantic`, `confidenceThreshold` | Props |
| `RightSidebar` | `components/common/RightSidebar/RightSidebar.tsx` | SearchPage, AssetsPage, MediaDetailPage, ImageDetailPage, CollectionViewPage, ShowcasePage (19+ import) | `children`, `alwaysVisible?` | Context (`useRightSidebar`) |

**Zustand stores:**

| Store | File | Stato core | Usato da |
|---|---|---|---|
| `useSearchStore` | `stores/searchStore.ts` | `query`, `isSemantic`, `semanticMode`, `filters: FacetFilters`, `ui.filterModalOpen`, `ui.filterModalDraft` | SearchPage, TopBar, FilterPopover (persistito su sessionStorage) |
| `useDashboardStore` | `features/dashboard/store/dashboardStore.ts` | `layout: DashboardLayout`, `editMode` | Home/Dashboard page (persistito su localStorage) |
| `playerTimeStore` | `components/player/playerTimeStore.ts` | `currentTime`, `duration` | Componenti player video/audio (vanilla Zustand, no re-render) |

---

## Interfacce TypeScript API Response

```typescript
// src/api/types/asset.types.ts
export interface Asset {
  InventoryID: string;
  DigitalSourceAsset: {
    ID: string;
    Type: string;
    CreateDate: string;
    MainRepresentation: {
      ID: string;
      Format: string;
      Purpose?: string;
      StorageInfo: {
        PrimaryLocation: {
          StorageType?: string;
          Bucket?: string;
          ObjectKey: { Name: string; Path?: string; FullPath: string };
          Status?: string;
          FileInfo: {
            Size: number;
            CreateDate?: string;
            Hash?: { Algorithm: string; Value: string };
          };
        };
      };
    };
  };
  DerivedRepresentations: Array<{
    ID: string;
    Type?: string;
    Format: string;
    Purpose: string; // "thumbnail" | "proxy" | "embedding" etc.
    StorageInfo: {
      PrimaryLocation: {
        StorageType?: string;
        Bucket?: string;
        Provider?: string;
        Status?: string;
        ObjectKey: { Name?: string; FullPath: string };
        FileInfo: { Size: number };
      };
    };
    URL?: string;
    ImageSpec?: { Resolution?: { Height: number; Width: number } };
  }>;
  Type?: string;
  Metadata?: any; // inferred: payload AI (Rekognition, Bedrock, TwelveLabs)
  relatedVersionsData?: RelatedVersionsResponse;
}

// src/api/hooks/useCollections.ts
export interface Collection {
  id: string;
  name: string;
  description?: string;
  type: "public" | "private" | "shared";
  parentId?: string;
  collectionTypeId?: string;
  ownerId: string;
  ownerName?: string;
  itemCount: number;
  childCount: number;
  childCollectionCount: number;
  isPublic: boolean;
  status: string;
  userRole?: string;
  createdAt: string;
  updatedAt: string;
  thumbnailType?: ThumbnailType;
  thumbnailValue?: string;
  thumbnailUrl?: string;
  isShared?: boolean;
  shareCount?: number;
  sharedWithMe?: boolean;
  myRole?: string;
  sharedAt?: string;
  sharedWith?: Array<{ targetId: string; targetType: string; role: string; grantedAt: string }>;
  ancestors?: Array<{ id: string; name: string; parentId?: string }>;
}

// src/api/types/pipeline.types.ts
// Nota: definizione backend più ricca (PipelineDefinition con nodes/edges) vive in Python;
// questo è il tipo del record restituito dalla list API
export interface Pipeline {
  id: string;
  name: string;
  system: boolean;
  type: string;
  createdAt: string;
  updatedAt: string;
  eventBridgeRuleArn: string;
  roleArn: string;
  queueUrl: string;
  queueArn: string;
  stateMachineArn: string;
  triggerLambdaArn: string;
}

// src/api/types/pipelineExecutions.types.ts
export interface PipelineExecution {
  execution_id: string;
  pipeline_id: string;
  pipeline_name: string;
  status: string; // "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT"
  start_time: string;
  end_time?: string;
  duration_seconds?: string;
  error_message?: string;
  steps?: Array<{
    step_id: string;
    status: string;
    start_time: string;
    end_time?: string;
    error_message?: string;
  }>;
}

// src/types/search.ts
export interface SearchResult {
  inventoryId: string;
  assetId: string;
  assetType: string;
  createDate: string;
  mainRepresentation: {
    id: string; type: string; format: string; purpose: string;
    storage: { storageType: string; bucket: string; path: string; status: string; fileSize: number; hashValue: string };
    imageSpec?: { colorSpace: string | null; width: number | null; height: number | null; dpi: number | null };
  };
  derivedRepresentations: Array<{
    id: string; type: string; format: string; purpose: string;
    storage: { storageType: string; bucket: string; path: string; status: string; fileSize: number; hashValue: string | null };
    imageSpec?: { colorSpace: string | null; width: number | null; height: number | null; dpi: number | null };
  }>;
  metadata: any;
  score: number;         // confidence score per semantic search
  thumbnailUrl: string | null;
  proxyUrl: string | null;
}

export interface SearchResponse {
  status: string;
  message: string;
  data: {
    searchMetadata: {
      totalResults: number;
      page: number;
      pageSize: number;
      searchTerm: string;
      facets: {
        file_types: {
          doc_count_error_upper_bound: number;
          sum_other_doc_count: number;
          buckets: Array<{ key: string; doc_count: number }>;
        };
      };
    };
    results: SearchResult[];
  };
}

// src/api/types/api.types.ts
export interface User {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  created: string;
  modified: string;
  email_verified: string;
  given_name: string | null;
  family_name: string | null;
  name?: string;
  groups: string[];
  permissions?: string[];
}

// src/permissions/types/permission.types.ts
export interface PermissionSet {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[]; // inferred: { action: string; subject: string; conditions?: object }[]
  createdAt: string;
  updatedAt: string;
}

// src/api/types/connector.types.ts
export interface Connector {
  id: string;
  name: string;
  type: string;          // "s3" (unico tipo attualmente)
  status: string;        // "active" | "syncing" | "error"
  created_at: string;
  updated_at: string;
  configuration: Record<string, any>; // inferred: { bucket, region, prefix, ... }
  storageIdentifier?: string;
  objectPrefix?: string;
}
```

---

## Effort Estimation Matrix

| Pagina | Shared components usati | N° API chiamate | Cross-domain | Stato (store/context) | Effort modifica UI | Effort sostituzione completa | Vincoli principali |
|---|---|---|---|---|---|---|---|
| `/` Home/Dashboard | DashboardGrid, widget (RecentAssetsWidget) | 5 | Sì (Dashboard + Search + Settings) | `dashboardStore` (Zustand) | 🟡 | 🟡 | Layout persistence su DynamoDB + localStorage |
| `/search` Ricerca | AssetResultsView, AssetTable, AssetGridView, RightSidebar | 6 | Sì (Search + Assets + Collections + Settings) | `searchStore` (Zustand, sessionStorage) | 🔴 | 🔴 | OpenSearch facets coupling, searchStore accoppiato al routing |
| `/assets` Asset Explorer | AssetResultsView, AssetTable, AssetGridView, RightSidebar | 4 | Sì (Connectors + Assets) | Props/Context | 🟡 | 🟡 | Pannello connettori e stato selezione accoppiati |
| `/images\|videos\|audio\|documents/:id` Dettaglio | RightSidebar, AssetCard, player (Omakase) | 7 | Sì (Assets + Collections + Search clip) | `playerTimeStore` (Zustand) | 🟡 | 🔴 | Omakase player lock-in, OpenSearch clip dependency |
| `/collections` Lista Collezioni | CollectionCard | 3 | No (Collections) | Props | 🟢 | 🟢 | CASL permission check su create/edit/delete |
| `/collections/:id/view` Vista Collezione | AssetResultsView, AssetTable, AssetGridView | 4 | Sì (Collections + OpenSearch via items) | Props/Context | 🟡 | 🟡 | OpenSearch facets coupling via `/collections/{id}/items` |
| `/pipelines` Lista Pipeline | PipelineTable, TriggerTypeChips, PipelineStatusCell | 4 | No (Pipelines) | Props | 🟢 | 🟡 | Stato real-time esecuzioni attive |
| `/pipelines/new`, `/settings/pipelines/edit/:id` Pipeline Editor | PipelineEditor (ReactFlow), NodeConfigurationForm | 3 | Sì (Nodes + Pipelines + Integrations) | ReactFlow internal state | 🔴 | 🔴 | ReactFlow/xyflow lock-in, node registry schema coupling |
| `/executions` Esecuzioni | ExecutionList, ExecutionMonitor | 3 | No (Pipelines Executions) | Props (polling) | 🟡 | 🟡 | WebSocket/polling real-time dependency |
| `/settings/profile` Profilo | — | 3 | No (Cognito SDK + Settings) | Props | 🟢 | 🟢 | Cognito SDK direct coupling (non via API Gateway) |
| `/settings/connectors` Connettori | ConnectorCard, ConnectorModal | 5 | No (Connectors) | Props | 🟢 | 🟡 | S3 bucket enumeration permessi IAM |
| `/settings/users` User Management | UserList, UserTableToolbar, ManageGroupsModal | 5 | Sì (Auth + Cognito) | Props | 🟡 | 🟡 | CASL permission check, Cognito status sync |
| `/settings/roles` Role Management | RoleList | 4 | No (Roles) | Props | 🟢 | 🟢 | — |
| `/settings/permissions` Permissions | GroupSelector | 3 | Sì (Groups + Authorization) | Props | 🟡 | 🟡 | CASL permission check, matrice permessi CASL |
| `/settings/integrations` Integrazioni | — | 4 | No (Integrations) | Props | 🟢 | 🟡 | Webhook URL validation accoppiata al pipeline trigger |
| `/settings/system` System Settings | — | 2 | No (Settings) | Props | 🟢 | 🟡 | Toggle search provider impatta `/search` globalmente |
| `/settings/environments` Environments | EnvironmentList | 4 | No (Environments) | Props | 🟢 | 🟢 | — |
