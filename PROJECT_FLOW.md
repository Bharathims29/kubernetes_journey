# Todo App on Kubernetes — Project Flow & Working Documentation

> A React frontend, Node.js/Express backend, and MongoDB deployed on Minikube
> Kubernetes under the `demo-app` namespace.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Component Breakdown](#2-component-breakdown)
3. [Kubernetes Resource Map](#3-kubernetes-resource-map)
4. [Request Flow (End-to-End)](#4-request-flow-end-to-end)
5. [Deployment / Build Flow](#5-deployment--build-flow)
6. [Configuration & Secrets Flow](#6-configuration--secrets-flow)
7. [Health Check & Probe Flow](#7-health-check--probe-flow)
8. [Local Dev vs Cluster Comparison](#8-local-dev-vs-cluster-comparison)

---

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Browser["🖥️ Browser"]
        U[User]
    end

    subgraph Cluster["☸️ Minikube Cluster — namespace: demo-app"]
        ING["🌐 Ingress (nginx)\nEntry Point"]

        subgraph FrontendLayer["Frontend Tier"]
            FSVC["Service: frontend\nport 80"]
            FPOD["Pod: frontend\nnginx:alpine :80\nreact-demo:latest"]
        end

        subgraph BackendLayer["Backend Tier"]
            BSVC["Service: backend\nport 5000"]
            BPOD["Pod: backend\nnode:20-alpine :5000\nnode-demo:latest"]
        end

        subgraph DataLayer["Data Tier"]
            MSVC["Service: mongodb\nClusterIP :27017"]
            MPOD["Pod: mongodb-0\nmongo:7.0 :27017\nStatefulSet"]
            PVC["PVC: mongodb-data\n1Gi persistent volume"]
        end

        CFG["ConfigMap: backend-config\nNODE_ENV, PORT, MONGODB_URI"]
        SEC["Secret: mongodb-credentials\nMONGODB_USERNAME, MONGODB_PASSWORD"]
    end

    U -->|"http://<minikube-ip>/"| ING
    ING -->|"path: /  → frontend"| FSVC
    ING -->|"path: /api → backend"| BSVC
    FSVC --> FPOD
    BSVC --> BPOD
    BPOD -->|"mongodb://mongodb:27017"| MSVC
    MSVC --> MPOD
    MPOD --> PVC
    CFG -.->|"envFrom"| BPOD
    SEC -.->|"envFrom"| BPOD
    SEC -.->|"MONGO_INITDB_ROOT_*"| MPOD
```

---

## 2. Component Breakdown

### 2.1 Frontend Component (`frontend/`)

```mermaid
flowchart LR
    subgraph Frontend["Frontend — Vite + React SPA"]
        subgraph Source["Source Code"]
            MAIN["main.jsx\nReactDOM.createRoot"]
            APP["App.jsx\nTodo List UI"]
            CSS["index.css\nStyling"]
        end

        subgraph Build["Build Pipeline"]
            VITE["Vite Build\nnpm run build"]
            DIST["dist/\nStatic HTML/JS/CSS"]
        end

        subgraph Runtime["Runtime Container"]
            NGINX["nginx:alpine\nport 80"]
            CONF["nginx.conf\ntry_files → index.html"]
        end
    end

    MAIN --> APP
    APP --> CSS
    APP -->|"fetch('/api/todos')"| API["/api/* routes"]
    VITE --> DIST
    DIST --> NGINX
    CONF --> NGINX
```

**Key responsibilities:**

| Component | Role |
|---|---|
| `main.jsx` | React entry point — mounts `<App />` into `#root` |
| `App.jsx` | Todo list UI — load, add, toggle, delete todos via relative `/api/*` URLs |
| `vite.config.js` | Dev proxy: `/api` → `http://localhost:5000` (local dev only) |
| `nginx.conf` | SPA fallback: `try_files $uri /index.html` |
| `Dockerfile` | Multi-stage: build with node → serve with nginx on port 80 |

### 2.2 Backend Component (`backend/`)

```mermaid
flowchart LR
    subgraph Backend["Backend — Node.js + Express"]
        subgraph Server["server.js"]
            EXPRESS["Express App"]
            MONGOOSE["Mongoose ODM"]
            SCHEMA["Todo Schema\n{ text, done, timestamps }"]
            ROUTES["REST Routes"]
        end

        subgraph Endpoints["API Endpoints"]
            H["GET /api/health"]
            L["GET /api/todos"]
            C["POST /api/todos"]
            U["PATCH /api/todos/:id"]
            D["DELETE /api/todos/:id"]
        end

        subgraph Env["Environment (process.env)"]
            PORT["PORT = 5000"]
            URI["MONGODB_URI"]
            USER["MONGODB_USERNAME"]
            PASS["MONGODB_PASSWORD"]
        end
    end

    EXPRESS --> MONGOOSE
    MONGOOSE --> SCHEMA
    EXPRESS --> ROUTES
    ROUTES --> H
    ROUTES --> L
    ROUTES --> C
    ROUTES --> U
    ROUTES --> D
    ENV -.-> EXPRESS
    MONGOOSE -->|"connect(uri, { auth })"| MONGODB[("MongoDB\nmongodb:27017")]
```

**API contract:**

| Method | Path | Purpose | Success | Error |
|---|---|---|---|---|
| GET | `/api/health` | Readiness/liveness probe | 200 | 503 |
| GET | `/api/todos` | List all todos (newest first) | 200 | — |
| POST | `/api/todos` | Create `{ text }` | 201 | 400 (empty text) |
| PATCH | `/api/todos/:id` | Update `text` / `done` | 200 | 404 |
| DELETE | `/api/todos/:id` | Delete a todo | 204 | 404 |

### 2.3 MongoDB Component (`k8s/mongodb.yaml`)

```mermaid
flowchart LR
    subgraph Mongo["MongoDB — StatefulSet"]
        STS["StatefulSet: mongodb\nreplicas: 1"]
        POD["Pod: mongodb-0\nmongo:7.0"]
        SVC["Service: mongodb\nClusterIP :27017"]
        VCT["volumeClaimTemplates\n1Gi"]
        PVC2["PVC: mongodb-data-mongodb-0"]
        VOL["/data/db"]
    end

    STS --> POD
    SVC --> POD
    POD --> VCT
    VCT --> PVC2
    PVC2 --> VOL
```

**Key characteristics:**

- **StatefulSet** (not Deployment) → stable pod name `mongodb-0` and stable PVC
- **Readiness probe** authenticates via `mongosh` (not just TCP check)
- **Liveness probe** uses TCP socket check
- **Root user** created on first boot from `mongodb-credentials` Secret

---

## 3. Kubernetes Resource Map

```mermaid
flowchart TB
    NS["Namespace: demo-app"] --> CFG["ConfigMap\nbackend-config"]
    NS --> SEC["Secret\nmongodb-credentials"]
    NS --> STS["StatefulSet\nmongodb"]
    NS --> BDEP["Deployment\nbackend"]
    NS --> FDEP["Deployment\nfrontend"]
    NS --> ING["Ingress\ndemo-app (nginx)"]

    STS --> BSVC["Service\nmongodb :27017"]
    BDEP --> BKSVC["Service\nbackend :5000"]
    FDEP --> FKSVC["Service\nfrontend :80"]

    CFG -->|"envFrom"| BDEP
    SEC -->|"envFrom"| BDEP
    SEC -->|"MONGO_INITDB_ROOT_*"| STS

    ING -->|"/api →"| BKSVC
    ING -->|"/ →"| FKSVC

    BKSVC -->|"targetPort: http"| BDEP
    FKSVC -->|"targetPort: http"| FDEP
    BSVC -->|"targetPort: mongodb"| STS
```

### Resource inventory

| Resource | Kind | Purpose |
|---|---|---|
| `demo-app` | Namespace | Isolates all workloads |
| `backend-config` | ConfigMap | Non-secret env: `NODE_ENV`, `PORT`, `MONGODB_URI` |
| `mongodb-credentials` | Secret | `MONGODB_USERNAME` / `MONGODB_PASSWORD` |
| `mongodb` | StatefulSet + Service | MongoDB 7.0 with 1Gi persistent storage |
| `backend` | Deployment + Service | Node.js API on port 5000 |
| `frontend` | Deployment + Service | nginx static server on port 80 |
| `demo-app` | Ingress | Path-based routing: `/api` → backend, `/` → frontend |

---

## 4. Request Flow (End-to-End)

### 4.1 Loading the page

```mermaid
sequenceDiagram
    participant B as Browser
    participant I as Ingress (nginx)
    participant F as Frontend Service
    participant FP as Frontend Pod (nginx)
    participant R as React App

    B->>I: GET http://<minikube-ip>/
    I->>F: path "/" matches frontend rule
    F->>FP: route to nginx pod :80
    FP-->>B: index.html + JS bundle
    B->>R: React mounts
    R->>B: fetch('/api/todos')
```

### 4.2 API call (GET /api/todos)

```mermaid
sequenceDiagram
    participant B as Browser
    participant I as Ingress (nginx)
    participant BS as Backend Service
    participant BP as Backend Pod (Express)
    participant MS as MongoDB Service
    participant MP as MongoDB Pod (mongodb-0)
    participant PVC as Persistent Volume

    B->>I: GET /api/todos
    I->>BS: path "/api" matches backend rule (most specific)
    BS->>BP: route to node pod :5000
    BP->>BP: Express handles GET /api/todos
    BP->>MS: Mongoose queries via mongodb://mongodb:27017
    MS->>MP: resolve DNS → mongodb-0 pod
    MP->>PVC: read/write /data/db
    PVC-->>MP: data
    MP-->>MS: query result
    MS-->>BP: JSON documents
    BP-->>BS: JSON response
    BS-->>I: JSON response
    I-->>B: JSON response
    B->>B: React renders todo list
```

### 4.3 Add / Toggle / Delete operations

```mermaid
sequenceDiagram
    participant B as Browser
    participant I as Ingress
    participant BP as Backend Pod
    participant M as MongoDB

    B->>I: POST /api/todos { text }
    I->>BP: route to backend
    BP->>M: Todo.create({ text })
    M-->>BP: saved document
    BP-->>B: 201 + todo JSON

    B->>I: PATCH /api/todos/:id { done }
    I->>BP: route to backend
    BP->>M: Todo.findByIdAndUpdate(id, { done })
    M-->>BP: updated document
    BP-->>B: 200 + todo JSON

    B->>I: DELETE /api/todos/:id
    I->>BP: route to backend
    BP->>M: Todo.findByIdAndDelete(id)
    M-->>BP: deleted document
    BP-->>B: 204 No Content
```

---

## 5. Deployment / Build Flow

```mermaid
flowchart LR
    subgraph Build["Build Images"]
        FB["minikube image build -t react-demo:latest ./frontend"]
        BB["minikube image build -t node-demo:latest ./backend"]
    end

    subgraph Deploy["Deploy to Minikube"]
        K["kubectl apply -k k8s"]
        N["namespace.yaml"]
        C["backend-config.yaml"]
        S["mongodb-secret.yaml"]
        M["mongodb.yaml"]
        B["backend.yaml"]
        F["frontend.yaml"]
        I["ingress.yaml"]
    end

    subgraph Verify["Verify Rollouts"]
        R1["kubectl rollout status statefulset/mongodb"]
        R2["kubectl rollout status deployment/backend"]
        R3["kubectl rollout status deployment/frontend"]
    end

    subgraph Access["Access App"]
        IP["minikube ip"]
        TUN["minikube tunnel (Docker driver)"]
    end

    FB --> K
    BB --> K
    K --> N
    K --> C
    K --> S
    K --> M
    K --> B
    K --> F
    K --> I
    M --> R1
    B --> R2
    F --> R3
    R1 --> IP
    R2 --> IP
    R3 --> IP
    IP --> TUN
```

### Deployment order (kustomization)

```mermaid
flowchart TB
    A["1. namespace.yaml\ncreates demo-app"] --> B["2. backend-config.yaml\nConfigMap"]
    B --> C["3. mongodb-secret.yaml\nSecret"]
    C --> D["4. mongodb.yaml\nStatefulSet + Service"]
    D --> E["5. backend.yaml\nDeployment + Service"]
    E --> F["6. frontend.yaml\nDeployment + Service"]
    F --> G["7. ingress.yaml\nIngress routing"]
```

---

## 6. Configuration & Secrets Flow

```mermaid
flowchart LR
    subgraph ConfigSources["Configuration Sources"]
        CM["ConfigMap: backend-config\n• NODE_ENV=development\n• PORT=5000\n• MONGODB_URI=mongodb://mongodb:27017/demo?authSource=admin"]
        SC["Secret: mongodb-credentials\n• MONGODB_USERNAME=admin\n• MONGODB_PASSWORD=Admin@123"]
    end

    subgraph Consumers["Consumers"]
        BE["Backend Pod\nprocess.env"]
        MO["MongoDB Pod\nMONGO_INITDB_ROOT_USERNAME\nMONGO_INITDB_ROOT_PASSWORD"]
    end

    CM -->|"envFrom: configMapRef"| BE
    SC -->|"envFrom: secretRef"| BE
    SC -->|"secretKeyRef"| MO

    BE -->|"mongoose.connect(URI, { auth: { username, password } })"| MO
```

**Why split ConfigMap and Secret?**

- **ConfigMap** holds the connection *string* — non-sensitive, safe to view/commit
- **Secret** holds the *credentials* — base64-encoded at rest, consumed by both Mongo (root user creation) and backend (authentication)
- Password is never embedded in the connection string itself

---

## 7. Health Check & Probe Flow

```mermaid
flowchart TB
    subgraph BackendProbes["Backend Pod Probes"]
        BR["readinessProbe\nGET /api/health\ninitialDelay: 5s, period: 5s"]
        BL["livenessProbe\nGET /api/health\ninitialDelay: 15s, period: 10s"]
    end

    subgraph FrontendProbes["Frontend Pod Probes"]
        FR["readinessProbe\nGET /\ninitialDelay: 5s, period: 5s"]
        FL["livenessProbe\nGET /\ninitialDelay: 15s, period: 10s"]
    end

    subgraph MongoProbes["MongoDB Pod Probes"]
        MR["readinessProbe\nmongosh ping (authenticated)\ninitialDelay: 5s, period: 5s"]
        ML["livenessProbe\nTCP socket :27017\ninitialDelay: 15s, period: 10s"]
    end

    BR -->|"200 = ready\n503 = not ready"| BE["Backend Pod"]
    BL -->|"200 = alive\n503 = restart"| BE
    FR -->|"200 = ready"| FE["Frontend Pod"]
    FL -->|"200 = alive"| FE
    MR -->|"ping ok = ready"| MP["MongoDB Pod"]
    ML -->|"port open = alive"| MP
```

---

## 8. Local Dev vs Cluster Comparison

```mermaid
flowchart TB
    subgraph Local["Local Development"]
        LFE["Vite Dev Server :5173"]
        LBE["Node Backend :5000"]
        LM["MongoDB (Docker/manual)"]
        LFE -->|"/api proxied"| LBE
        LBE -->|"MONGODB_URI set by hand"| LM
    end

    subgraph Cluster["Kubernetes (Minikube)"]
        CFE["Frontend Pod (nginx :80)"]
        CBE["Backend Pod (node :5000)"]
        CM["MongoDB Pod (mongodb-0)"]
        ING2["Ingress"]
        CFE -->|"relative /api/*"| ING2
        ING2 -->|"path /api"| CBE
        CBE -->|"ConfigMap + Secret envFrom"| CM
    end
```

| Aspect | Local Dev | Kubernetes |
|---|---|---|
| Frontend calls `/api/*` | Vite proxy → `localhost:5000` | Ingress → `backend` Service |
| Backend Mongo connection | `MONGODB_URI` set manually | Injected via ConfigMap + Secret `envFrom` |
| Mongo | Run in Docker manually | StatefulSet + PVC, DNS name `mongodb` |
| Code branching | None — same code | None — only wiring changes |

---

## Quick Reference Commands

```bash
# Build images into Minikube
minikube image build -t react-demo:latest ./frontend
minikube image build -t node-demo:latest ./backend

#install ingress

minikube addons enable ingress

# Deploy everything
kubectl apply -k k8s

# Verify rollouts
kubectl rollout status statefulset/mongodb -n demo-app
kubectl rollout status deployment/backend -n demo-app
kubectl rollout status deployment/frontend -n demo-app

# Access
minikube ip
minikube tunnel   # only for Docker driver

# Inspect
kubectl get all,ingress,pvc -n demo-app
kubectl logs deployment/backend -n demo-app

# Cleanup
kubectl delete -k k8s