# Mock Frontend — Guida rapida per aggiungere tab e gestire visibilità per ruolo

Questo documento spiega a Claude (e a chiunque altro) **come aggiungere una nuova tab nella sidebar** del frontend MediaLake e **come limitarne la visibilità in base al ruolo dell'utente**.

Stack: React 19 + TypeScript 5 + Vite 7 + MUI 7 + React Router 7 + CASL 6 (RBAC).

---

## 1. Aggiungere una nuova tab nella sidebar

Servono tre modifiche, in tre file diversi. L'ordine non conta, ma serve farle tutte e tre.

### 1.1 Creare la pagina

File: `src/pages/<NomeTua>Page.tsx`

```tsx
import React from "react";
import { Box, Typography } from "@mui/material";

const MyNewPage: React.FC = () => {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4">Hello</Typography>
    </Box>
  );
};

export default MyNewPage;
```

**Regole**:
- Default export (richiesto da `React.lazy`)
- Padding interno (`p: 4` o `sx={{ p: 4 }}`) — il layout esterno non lo aggiunge
- Usa componenti MUI (`@mui/material`) per coerenza con il resto dell'app
- Per esempi più ricchi (tabella, form, card stats, alert) vedi [`src/pages/ShowcasePage.tsx`](src/pages/ShowcasePage.tsx)

### 1.2 Registrare la rotta

File: [`src/routes/router.tsx`](src/routes/router.tsx)

Aggiungi il lazy import vicino agli altri:

```tsx
const LazyMyNewPage = lazyLoad(() => import("@/pages/MyNewPage"));
```

Aggiungi la child route dentro l'array `children` della route `/` (quella protetta da `ProtectedRoute`):

```tsx
{ path: "my-new", element: LazyMyNewPage },
```

Per default la rotta è accessibile a qualsiasi utente autenticato. Per restringerla a un ruolo vedi la **sezione 2**.

### 1.3 Aggiungere la voce in sidebar

File: [`src/Sidebar.tsx`](src/Sidebar.tsx)

Importa un'icona MUI:

```tsx
import { Star as MyNewIcon } from "@mui/icons-material";
```

Aggiungi un oggetto all'array `mainMenuItems` (intorno alla riga 160):

```tsx
{
  text: "My New Tab",                // testo visibile
  icon: <MyNewIcon />,
  path: "/my-new",                   // deve corrispondere alla route
  disabled: false,                   // true = greyed out + tooltip
  adminOnly: false,                  // true = nascosto se visible=false
},
```

**Campi importanti** (vedi il `mainMenuItems` esistente in `Sidebar.tsx`):

| Campo | Comportamento |
|-------|---------------|
| `disabled: true` | Voce sempre visibile ma grigia + tooltip "no permission" |
| `adminOnly: true` + `visible: false` | Voce completamente nascosta |
| `adminOnly: true` + `visible: true` | Voce visibile (come gli altri) |
| `isExpandable: true` + `subItems: [...]` | Diventa un gruppo collassabile (vedi voce "Settings") |

### 1.4 Verificare

```bash
cd medialake_user_interface
npm run dev
```

Vite ricarica in <500ms. La voce dovrebbe apparire nella sidebar e cliccarci sopra ti porta alla pagina.

---

## 2. Visibilità per ruolo

**Sì, è possibile** e l'app ha già tutto il sistema in piedi.

### 2.1 Come funzionano i ruoli in MediaLake

Il frontend usa **CASL** ([@casl/ability](https://casl.js.org/)) per RBAC.

Flusso:
1. L'utente fa login con Cognito
2. Il JWT contiene `cognito:groups` (array di gruppi Cognito a cui l'utente appartiene) — vedi [`ability-factory.ts:285`](src/permissions/utils/ability-factory.ts#L285)
3. Il backend MediaLake mappa i gruppi a **permission sets** (insieme di permessi `action + subject`)
4. CASL costruisce un'`Ability` con le regole effettive dell'utente

Le `Actions` e `Subjects` esistenti sono definite in [`src/permissions/types/ability.types.ts`](src/permissions/types/ability.types.ts):

- **Actions**: `view`, `edit`, `delete`, `create`, `upload`, `download`, `share`, `manage`, `run`, `add`, `disable`, `admin`
- **Subjects**: `asset`, `pipeline`, `connector`, `user`, `group`, `settings`, `settings-menu`, `permission-set`, `integration`, `region`, `system-settings`, `collection-types`, `collection`, `search`, `storage`, `execution`, `node`, `dashboard`, `defaultDashboard`, `api-key`, `all`

### 2.2 Tre punti dove applicare la check

#### A) Proteggere la **rotta** (router.tsx)

```tsx
import { RoutePermissionGuard } from "@/permissions";

{
  path: "my-new",
  element: (
    <RoutePermissionGuard
      permission={{ action: "view", subject: "asset" }}
      element={LazyMyNewPage}
    />
  ),
},
```

Se l'utente non ha il permesso → redirect a `/access-denied`.

#### B) Disabilitare/nascondere la **voce in sidebar** (Sidebar.tsx)

Pattern già usato — vedi le voci "Pipelines" o "Settings":

```tsx
// Greyed out con tooltip se non ha permesso
{
  text: "My New Tab",
  icon: <MyNewIcon />,
  path: "/my-new",
  disabled: !safePermissionCheck("view", "asset"),
  adminOnly: false,
},

// Completamente nascosta se non admin
{
  text: "My Admin Tab",
  icon: <MyNewIcon />,
  path: "/my-admin",
  disabled: false,
  adminOnly: true,
  visible: safePermissionCheck("admin", "all"),
},
```

#### C) Mostrare/nascondere singoli **elementi UI** dentro una pagina

```tsx
import { Can } from "@/permissions";

<Can I="delete" a="asset">
  <Button color="error">Delete</Button>
</Can>

// oppure greyed out invece di nascosto
<Can I="delete" a="asset" passThrough disabledTooltip="No permission">
  <Button color="error">Delete</Button>
</Can>
```

Per controlli ad-hoc usa l'hook:

```tsx
import { usePermission } from "@/permissions";

const { can } = usePermission();
if (can("edit", "asset")) { /* ... */ }
```

### 2.3 Per la pagina **mock/showcase** (senza backend reale)

Le mock-pages non hanno un `subject` CASL dedicato. Tre opzioni:

**Opzione 1 — Riusa un subject esistente** (più semplice). Es. mostra la tab solo se l'utente può `manage settings`:

```tsx
disabled: !safePermissionCheck("manage", "settings"),
```

**Opzione 2 — Check diretto sui Cognito groups** (più "mock"). Bypassa CASL:

```tsx
import { fetchAuthSession } from "aws-amplify/auth";
import { useEffect, useState } from "react";

const useIsInGroup = (groupName: string) => {
  const [isInGroup, setIsInGroup] = useState(false);
  useEffect(() => {
    fetchAuthSession().then((session) => {
      const groups = (session.tokens?.idToken?.payload["cognito:groups"] as string[]) || [];
      setIsInGroup(groups.includes(groupName));
    });
  }, [groupName]);
  return isInGroup;
};

// uso in un componente
const isDemo = useIsInGroup("demo-users");
if (!isDemo) return null;
```

Per creare il gruppo Cognito:
```bash
aws cognito-idp create-group --user-pool-id <UPI> --group-name demo-users
aws cognito-idp admin-add-user-to-group --user-pool-id <UPI> \
  --username <email> --group-name demo-users
```

**Opzione 3 — Aggiungere un nuovo `Subject` CASL** (più pulito, più invasivo):

1. Aggiungi il subject in [`ability.types.ts`](src/permissions/types/ability.types.ts) (lista `Subjects`)
2. Aggiorna i permission sets backend per assegnarlo ai ruoli
3. Usa `<Can I="view" a="my-mock-tab">` come per qualsiasi altro

Per uno **showcase puro** consigliata l'**Opzione 1** o **2**. L'Opzione 3 è giusta solo se la feature diventerà reale.

---

## 3. Checklist quando Claude aggiunge una nuova tab

- [ ] Creato `src/pages/<Nome>Page.tsx` con default export
- [ ] Aggiunto `LazyXxx` + child route in `src/routes/router.tsx`
- [ ] Aggiunta icona + entry in `mainMenuItems` in `src/Sidebar.tsx`
- [ ] Decisa la strategia di visibilità (pubblica / per ruolo / admin only)
- [ ] Se per ruolo: `RoutePermissionGuard` su rotta **E** `disabled`/`visible` in sidebar (entrambi, non solo uno)
- [ ] Testato con `npm run dev` su [http://localhost:5173](http://localhost:5173)
- [ ] (Opzionale) Aggiunte chiavi i18n in `src/i18n/locales/` invece di stringhe hardcoded

---

## 4. Riferimenti veloci

| Cosa | File |
|------|------|
| Router | [`src/routes/router.tsx`](src/routes/router.tsx) |
| Sidebar | [`src/Sidebar.tsx`](src/Sidebar.tsx) |
| Layout esterno | [`src/components/AppLayout.tsx`](src/components/AppLayout.tsx) |
| Auth check | [`src/components/ProtectedRoute.tsx`](src/components/ProtectedRoute.tsx) |
| Permission guard rotte | [`src/permissions/components/PermissionGuard.tsx`](src/permissions/components/PermissionGuard.tsx) |
| `<Can>` UI inline | [`src/permissions/components/Can.tsx`](src/permissions/components/Can.tsx) |
| Hook `usePermission` | [`src/permissions/hooks/usePermission.ts`](src/permissions/hooks/usePermission.ts) |
| Actions/Subjects CASL | [`src/permissions/types/ability.types.ts`](src/permissions/types/ability.types.ts) |
| Esempio pagina mock completa | [`src/pages/ShowcasePage.tsx`](src/pages/ShowcasePage.tsx) |
| Doc README permessi | [`src/permissions/README.md`](src/permissions/README.md) |
