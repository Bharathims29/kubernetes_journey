# React, Node, MongoDB Minikube Demo

This manifest set deploys a React frontend, a Node.js API, and MongoDB into the
`demo-app` namespace. The frontend and backend images are built locally into
Minikube; MongoDB uses its official image and a 1 GiB persistent volume claim.

## Application contract

- Frontend image: `react-demo:latest`, serving the production React build on port `80`.
- Backend image: `node-demo:latest`, listening on port `5000`.
- Backend health endpoint: `GET /api/health`, returning HTTP 200 when ready.
- Frontend API requests: use relative `/api/...` URLs.

The Ingress sends `/api` traffic to the backend and all other traffic to the
frontend. MongoDB is only reachable inside the cluster. `backend-config` stores
`MONGODB_URI=mongodb://mongodb:27017/demo?authSource=admin`, while the
`mongodb-credentials` Secret provides `MONGODB_USERNAME` and
`MONGODB_PASSWORD` to the Node.js backend.

When connecting with the MongoDB Node.js driver, pass the URI and credentials
separately so the password never needs to be placed in the ConfigMap:

```js
new MongoClient(process.env.MONGODB_URI, {
  auth: {
    username: process.env.MONGODB_USERNAME,
    password: process.env.MONGODB_PASSWORD,
  },
});
```

## Run with Minikube

Start Minikube and enable its NGINX Ingress controller:

```bash
minikube start
minikube addons enable ingress
```

Build your two local projects directly into Minikube. Run these commands from
the directory containing `frontend/` and `backend/`:

```bash
minikube image build -t react-demo:latest ./frontend
minikube image build -t node-demo:latest ./backend
```

Deploy and wait for the workloads:

```bash
kubectl apply -k k8s
kubectl rollout status statefulset/mongodb -n demo-app
kubectl rollout status deployment/backend -n demo-app
kubectl rollout status deployment/frontend -n demo-app
```

Open the app at the Minikube IP:

```bash
minikube ip
```

For the Docker driver, keep this running in a second terminal before opening
the displayed IP in a browser:

```bash
minikube tunnel
```

## Useful checks

```bash
kubectl get all,ingress,pvc -n demo-app
kubectl logs deployment/backend -n demo-app
kubectl delete -k k8s
```

MongoDB authentication is enabled with the local demo credentials `admin` /
`Admin@123`. The Secret is intentionally committed for this test project only;
use an external secret manager or an uncommitted Secret manifest for real
environments.

If you had already started the previous unauthenticated MongoDB pod, delete
its existing PVC before redeploying to initialize the root user. This removes
the old demo data:

```bash
kubectl delete pvc mongodb-data-mongodb-0 -n demo-app
```
