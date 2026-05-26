# PoC: Reviewer Group + Gating della tab Review

## Context

È stata aggiunta una nuova tab "Review" nel frontend MediaLake ([Sidebar.tsx](../medialake_user_interface/src/Sidebar.tsx) — era `adminOnly: false` quindi tutti la vedono, e [router.tsx](../medialake_user_interface/src/routes/router.tsx) — non aveva guard). Si vuole introdurre un **nuovo gruppo "Reviewer"** che veda esclusivamente le tab **Assets** (read-only + download) e **Review** (view + edit), e nascondere la tab Review ai gruppi **Editor** e **Read Only**. **Super Administrator** continua a vedere tutto.

Scelte concordate:
- Reviewer su Assets → read-only + download (stesso livello del `viewer` esistente).
- Reviewer su Review → `view` + `edit` (niente delete).
- La feature Review è **solo frontend** per ora → nessun cambio al `custom_authorizer` (non c'è API da proteggere).

L'architettura MediaLake supporta nativamente questo caso d'uso: ai gruppi sono associati permission set, i permessi vengono iniettati nel JWT come `custom:permissions` dal lambda `pre_token_generation`, e CASL nel frontend valuta le permission per gate di sidebar/router. `reviews` è già presente come chiave permessi nel `superAdministrator` set e la mappa `resourceMapping` in [ability-factory.ts](../medialake_user_interface/src/permissions/utils/ability-factory.ts) traduce già `reviews → reviews` per CASL.

---

## Modifiche (5 file) — già implementate

### 1) Backend — Cognito user pool group
**File:** [medialake_constructs/cognito.py](../medialake_constructs/cognito.py)

Aggiunto `CognitoGroupConfig`:
```python
CognitoGroupConfig(
    name="reviewers",
    description="Review-only access: can view assets and read/edit reviews",
    precedence=30,  # tra editors (20) e read-only (40)
),
```

### 2) Backend — DDB seeder (gruppo logico + permission set)
**File:** [lambdas/auth/auth_seeder/index.py](../lambdas/auth/auth_seeder/index.py)

**a.** Aggiunto a `DEFAULT_GROUPS`:
```python
{
    "id": "reviewers",
    "name": "Reviewer",
    "description": "Read-only access to assets plus the ability to view and edit reviews",
    "department": "Review",
    "assignedPermissionSets": ["reviewer"],
},
```

**b.** Aggiunto a `DEFAULT_PERMISSION_SETS`:
```python
{
    "id": "reviewer",
    "name": "Reviewer",
    "description": "Read-only access to assets plus view/edit on the Review tab",
    "isSystem": True,
    "effectiveRole": "Reviewer",
    "permissions": {
        "assets": {"upload": False, "download": True, "view": True, "edit": False, "delete": False},
        "reviews": {"view": True, "edit": True, "delete": False},
        "search": {"view": True},
        "system": {"view": True, "edit": False},
        "connectors": {"view": True},
        "nodes": {"view": True},
        "regions": {"view": True},
        "storage": {"view": True},
    },
},
```

**c.** `PERMISSION_SCHEMA_VERSION` bumped `"2.4.0"` → `"2.5.0"` per forzare l'aggiornamento dei permission set di sistema sui deploy esistenti.

### 3) Frontend — tipo CASL Subjects
**File:** [medialake_user_interface/src/permissions/types/ability.types.ts](../medialake_user_interface/src/permissions/types/ability.types.ts)

Aggiunto `"reviews"` al union `Subjects`:
```typescript
| "defaultDashboard"
| "reviews";
```

### 4) Frontend — Sidebar gating
**File:** [medialake_user_interface/src/Sidebar.tsx](../medialake_user_interface/src/Sidebar.tsx)

Aggiunto memo:
```typescript
const canViewReview = useMemo(
  () => safePermissionCheck("view", "reviews") ?? false,
  [safePermissionCheck]
);
```

Voce Review modificata (`adminOnly: true` + `visible`):
```typescript
{
  text: "Review",
  icon: <ShowcaseIcon />,
  path: "/review",
  disabled: false,
  adminOnly: true,
  visible: canViewReview,
  badge: "DEMO",
},
```

### 5) Frontend — Router guard sulla route `/review`
**File:** [medialake_user_interface/src/routes/router.tsx](../medialake_user_interface/src/routes/router.tsx)

```tsx
{
  path: "review",
  element: (
    <RoutePermissionGuard
      permission={{ action: "view", subject: "reviews" }}
      element={LazyReviewPage}
    />
  ),
},
```

---

## Cosa NON è stato toccato

- **`custom_authorizer`**: la feature Review è solo frontend (no API). Se arriverà un'API `/reviews/*`, andrà aggiunta lì.
- **Editor e Read Only**: i loro permission set non contengono la chiave `reviews`, quindi non avranno `reviews:view` nel JWT — il gate li esclude automaticamente senza modifiche.
- **`resourceMapping`** in ability-factory.ts: già contiene `reviews: "reviews"` — il flusso permission set → JWT → CASL funziona out of the box.
- **`superAdministrator`**: ha già `reviews: {view, edit, delete}`, continua a vedere tutto.

---

## Verifica end-to-end

1. **Deploy backend** con `cdk deploy` (stack `CognitoStack` + `AuthorizationStack`). Verificare nei log del seeder che `PS#reviewer` e `GROUP#reviewers` siano stati creati nella DDB `auth_table`.
2. **Cognito console** → User Pool → Groups: deve apparire `reviewers` con precedence 30.
3. **Creare un utente di test** assegnandolo al solo gruppo `reviewers`. Login dalla UI.
4. **Test A — Reviewer**:
   - Sidebar mostra: Home, **Review**, **Assets**. Settings non visibile.
   - `/review` → caricata correttamente.
   - `/assets` → caricata, ma upload/edit/delete disabilitati.
5. **Test B — Editor / Read Only**:
   - Sidebar **non** mostra la voce Review.
   - URL diretto `/review` → `RoutePermissionGuard` blocca con accesso negato.
6. **Test C — Super Administrator**: continua a vedere e usare la tab Review come prima.
7. **CloudWatch logs** del `pre_token_generation` Lambda per un utente Reviewer: `custom:permissions` deve contenere `reviews:view`, `reviews:edit`, `assets:view`, `assets:download`.

---

## Note operative

- **PERMISSION_SCHEMA_VERSION bump è importante**: senza, su stack esistenti il seeder non aggiorna i permission set già presenti. Il nuovo `reviewer` viene creato comunque (è nuovo), ma il bump garantisce consistenza per futuri aggiornamenti.
- **Casi limite UI**: le voci sidebar (Collections, Pipelines) per il Reviewer **non vengono nascoste**, restano visibili/disabled come per gli altri gruppi. Nasconderle specificamente per Reviewer è fuori scope.
- **Cognito group name vs DDB id**: entrambi `reviewers`, allineato alla convenzione esistente (`superAdministrators`, `editors`). Il `pre_token_generation` matcha sull'id Cognito (`cognito:groups` claim) → DDB key `GROUP#reviewers`.
