# How It Works: Todo App on Kubernetes

A React frontend, a Node/Express backend, and MongoDB, all running in a
Minikube cluster under the `demo-app` namespace. This doc explains what each
piece does and how a request travels through the system.

## 1. Architecture at a glance

```
                    ┌────────────────────────────────────────┐
                    │            Minikube cluster             │
                    │            namespace: demo-app          │
                    │                                          │
 browser ──▶ Ingress│  / ──────────▶ frontend Service ──▶ frontend Pod (nginx:80)
 (minikube ip)      │  /api ───────▶ backend Service ───▶ backend Pod (node:5000)
                    │                                    │       │
                    │                                    ▼       │
                    │                          mongodb Service ──┘
                    │                          (ClusterIP:27017)
                    │                                    │
                    │                          mongodb-0 Pod (StatefulSet)
                    │                                    │
                    │                          PVC: mongodb-data (1Gi)
                    └────────────────────────────────────────┘
```

Four workloads, wired together by Kubernetes Services (stable DNS names) and
one Ingress that fans traffic out based on URL path.

## 2. The backend (`backend/`)

[`server.js`](../backend/server.js) is a single-file Express app.

- **Startup**: connects to MongoDB via Mongoose *before* the HTTP server
  starts listening (`await mongoose.connect(...)`). If Mongo isn't reachable
  yet, the container crashes and Kubernetes restarts it — a deliberate
  fail-fast instead of serving traffic against a dead DB connection.
- **Config source**: `PORT`, `MONGODB_URI`, `MONGODB_USERNAME`,
  `MONGODB_PASSWORD` all come from `process.env`. Nothing is hardcoded — the
  same image runs anywhere as long as those env vars are supplied (that's
  what `backend-config.yaml` and `mongodb-secret.yaml` do, see below).
- **Data model**: one Mongoose schema, `Todo { text: String, done: Boolean }`,
  with `timestamps: true` so `createdAt`/`updatedAt` are automatic.
- **Routes**:
  | Method | Path | Purpose |
  |---|---|---|
  | GET | `/api/health` | 200 if `mongoose.connection.readyState === 1`, else 503. Used by k8s probes. |
  | GET | `/api/todos` | list all todos, newest first |
  | POST | `/api/todos` | create `{ text }`, 400 if empty |
  | PATCH | `/api/todos/:id` | update `text` and/or `done`, 404 if missing |
  | DELETE | `/api/todos/:id` | delete, 404 if missing |
- **Dockerfile**: single-stage `node:20-alpine`, `npm install --omit=dev`,
  `CMD node server.js`. No build step needed — it's plain JS.

## 3. The frontend (`frontend/`)

A Vite + React single-page app ([`src/App.jsx`](../frontend/src/App.jsx)).

- **In the browser**: on load it `fetch('/api/todos')`s the list, and renders
  add/toggle/delete controls that call the same `/api/*` routes. It never
  hardcodes a hostname — every call is a **relative URL**. That's what lets
  the exact same static build work in dev, in Docker, and behind the Ingress.
- **Dev mode** (`npm run dev`): [`vite.config.js`](../frontend/vite.config.js)
  proxies `/api` to `http://localhost:5000` so you can run backend + frontend
  locally without Kubernetes at all.
- **Production build** (`npm run build`): Vite outputs static HTML/JS/CSS to
  `dist/`.
- **Dockerfile**: two stages —
  1. `node:20-alpine` installs deps and runs `vite build`.
  2. `nginx:alpine` copies `dist/` into `/usr/share/nginx/html` and serves it
     on port 80 using [`nginx.conf`](../frontend/nginx.conf), which
     `try_files $uri /index.html` so client-side routing (if added later)
     doesn't 404 on refresh.
  The final image contains no Node.js or source — just nginx + static files.
  Notice nginx does **not** proxy `/api` — that job belongs to the Ingress,
  one layer up, because in the cluster the frontend Pod and backend Pod are
  siblings, not parent/child.

## 4. The Kubernetes manifests (`k8s/`)

Applied together via [`kustomization.yaml`](../k8s/kustomization.yaml), in
this order:

1. **[`namespace.yaml`](../k8s/namespace.yaml)** — creates `demo-app`. Every
   other manifest sets `metadata.namespace: demo-app` so all four workloads,
   their Services, and the Ingress live in one isolated namespace.

2. **[`backend-config.yaml`](../k8s/backend-config.yaml)** — a ConfigMap
   (non-secret config) with `NODE_ENV`, `PORT=5000`, and
   `MONGODB_URI=mongodb://mongodb:27017/demo?authSource=admin`. The hostname
   `mongodb` in that URI resolves via Kubernetes' internal DNS to the
   `mongodb` Service defined in `mongodb.yaml` — this is the only thing
   tying the backend to Mongo's location.

3. **[`mongodb-secret.yaml`](../k8s/mongodb-secret.yaml)** — a Secret holding
   `MONGODB_USERNAME`/`MONGODB_PASSWORD`. Kept separate from the ConfigMap
   because Secrets get base64-encoded storage and can be swapped for a real
   secret manager later without touching the ConfigMap. Committed here only
   because this is a local demo (the README calls this out explicitly).

4. **[`mongodb.yaml`](../k8s/mongodb.yaml)** — a **StatefulSet** (not a
   Deployment) plus a headless-style Service:
   - StatefulSet gives the pod a stable name (`mongodb-0`) and a stable PVC
     (`mongodb-data-mongodb-0`), so data survives pod restarts/reschedules —
     a plain Deployment would attach a fresh empty volume on every
     reschedule with more than one strategy.
   - The container reads `MONGO_INITDB_ROOT_USERNAME`/`_PASSWORD` from the
     same Secret the backend uses, so on first boot Mongo creates that admin
     user — this is why username/password must match on both sides.
   - `volumeClaimTemplates` requests a 1Gi PVC per replica; Minikube's
     default StorageClass provisions it automatically.
   - Readiness probe actually authenticates (`mongosh ... --eval
     'db.adminCommand({ping:1})'`) rather than just checking the port is
     open, so Kubernetes won't route traffic to Mongo until auth is working.

5. **[`backend.yaml`](../k8s/backend.yaml)** — Deployment + Service:
   - `envFrom` pulls in *both* the ConfigMap and the Secret, which is exactly
     what `server.js` expects on `process.env`.
   - `readinessProbe`/`livenessProbe` hit `GET /api/health` — the same route
     `server.js` defines, so a broken Mongo connection makes the pod
     unready/restarted instead of silently serving errors.
   - The container port is named `http` and the Service targets that name
     (`targetPort: http`) rather than a raw number — if the container port
     ever changes, only one field needs to change.

6. **[`frontend.yaml`](../k8s/frontend.yaml)** — Deployment + Service,
   simpler: no env vars needed (nothing to configure, it just serves static
   files and calls relative `/api/...`), probes hit `/` on port 80.

7. **[`ingress.yaml`](../k8s/ingress.yaml)** — the single entry point:
   - `path: /api` (Prefix) → `backend` Service
   - `path: /` (Prefix) → `frontend` Service
   Path order matters here: Ingress-nginx matches the most specific prefix,
   so `/api` requests never fall through to the frontend rule.

## 5. End-to-end request flow

**Loading the page:**
1. Browser hits `http://<minikube-ip>/`.
2. Ingress matches `/` → routes to `frontend` Service → an nginx Pod.
3. nginx returns `index.html` + the built JS bundle.
4. The React app mounts and immediately calls `fetch('/api/todos')`.

**That API call:**
1. Same browser, same `<minikube-ip>` host, now path `/api/todos`.
2. Ingress matches `/api` (wins over `/`) → routes to `backend` Service → a
   Node Pod on port 5000.
3. Express handles `GET /api/todos`, Mongoose queries the `todos` collection
   over the `mongodb` Service (ClusterIP DNS name) → StatefulSet Pod
   `mongodb-0` → PVC-backed `/data/db`.
4. JSON flows back the same path to the browser, React renders the list.

**Adding/toggling/deleting** follow the identical path with `POST`/`PATCH`/
`DELETE` — the frontend never talks to Mongo or to the backend Pod directly,
only through the Ingress + Service layer, so backend replicas can scale or
restart without the frontend knowing.

## 6. Why credentials/config are split the way they are

- `backend-config.yaml` (ConfigMap): the connection **string** — not
  secret, safe to view in `kubectl describe`, safe to check into git.
- `mongodb-secret.yaml` (Secret): the **credentials** — base64-encoded at
  rest, consumed by both Mongo (to create the root user) and the backend (to
  authenticate). Passing the URI and credentials separately, as
  `server.js` does (`mongoose.connect(uri, { auth: { username, password } })`),
  means the password is never embedded inside the connection string itself.

## 7. Local dev vs. cluster — same code, different wiring

| | Local dev | Kubernetes |
|---|---|---|
| Frontend calls `/api/*` | proxied by Vite dev server to `localhost:5000` | routed by Ingress to `backend` Service |
| Backend Mongo connection | `MONGODB_URI` set by hand / `.env` | injected via ConfigMap + Secret `envFrom` |
| Mongo | run in Docker manually | StatefulSet + PVC, DNS name `mongodb` |

The frontend and backend code never branch on environment — only the
*wiring around them* changes, which is the point of keeping config out of
the source.
