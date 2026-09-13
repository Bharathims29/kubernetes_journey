# Kubernetes Deployment and Release Flow

This project deploys a React frontend, Node/Express backend, and MongoDB into
the `demo-app` namespace.

Use this flow for the first cluster deployment and for later releases like
`v2`, `v3`, and so on.

## Current Kubernetes Stack

| Component | Kubernetes resource | Image |
|---|---|---|
| Frontend | `Deployment/frontend` + `Service/frontend` | `react-demo:<version>` |
| Backend | `Deployment/backend` + `Service/backend` | `node-demo:<version>` |
| MongoDB | `StatefulSet/mongodb` + `Service/mongodb` | `mongo:7.0` |
| Entry point | `Ingress/demo-app` | nginx ingress |
| Namespace | `demo-app` | - |

The manifests are applied together with:

```bash
kubectl apply -k k8s
```

## 1. First-Time Cluster Start

Start Minikube:

```bash
minikube start
```

Enable the nginx ingress controller:

```bash
minikube addons enable ingress
```

Check the cluster:

```bash
kubectl get nodes
kubectl get pods -A
```

## 2. First Release: v1

Build the frontend and backend images into Minikube:

```bash
minikube image build -t react-demo:v1 ./frontend
minikube image build -t node-demo:v1 ./backend
```

Update the image tags in the manifests:

```yaml
# k8s/frontend.yaml
image: react-demo:v1

# k8s/backend.yaml
image: node-demo:v1
```

Deploy all Kubernetes resources:

```bash
kubectl apply -k k8s
```

Wait for everything to become ready:

```bash
kubectl rollout status statefulset/mongodb -n demo-app
kubectl rollout status deployment/backend -n demo-app
kubectl rollout status deployment/frontend -n demo-app
```

Inspect the app:

```bash
kubectl get all,ingress,pvc -n demo-app
```

Access it:

```bash
minikube ip
```

If Minikube uses the Docker driver, keep this running in another terminal:

```bash
minikube tunnel
```

## 3. Next Release: v2, v3, ...

For each new release, build new immutable image tags. Do not reuse `latest`
for real releases.

Example for `v2`:

```bash
minikube image build -t react-demo:v2 ./frontend
minikube image build -t node-demo:v2 ./backend
```

Update the manifests:

```yaml
# k8s/frontend.yaml
image: react-demo:v2

# k8s/backend.yaml
image: node-demo:v2
```

Apply the next release:

```bash
kubectl apply -k k8s
```

Watch the rolling update:

```bash
kubectl rollout status deployment/backend -n demo-app
kubectl rollout status deployment/frontend -n demo-app
```

Verify:

```bash
kubectl get pods -n demo-app
kubectl get deployments -n demo-app
kubectl logs deployment/backend -n demo-app
```

Use the same pattern for `v3`:

```bash
minikube image build -t react-demo:v3 ./frontend
minikube image build -t node-demo:v3 ./backend
```

Then change the manifests from `v2` to `v3` and run:

```bash
kubectl apply -k k8s
```

## 4. Fast Image Update Option

For quick local testing, you can update the running Deployments directly:

```bash
kubectl set image deployment/backend backend=node-demo:v2 -n demo-app
kubectl set image deployment/frontend frontend=react-demo:v2 -n demo-app
```

This is useful for quick experiments, but remember: if the manifest files still
say `v1`, the next `kubectl apply -k k8s` will move the cluster back to `v1`.
For a proper release, update the YAML files and commit the change.

## 5. Rollback

If the new release is bad, roll back the frontend and backend:

```bash
kubectl rollout undo deployment/backend -n demo-app
kubectl rollout undo deployment/frontend -n demo-app
```

Check rollout history:

```bash
kubectl rollout history deployment/backend -n demo-app
kubectl rollout history deployment/frontend -n demo-app
```

## 6. Recommended Release Checklist

1. Make code changes in `frontend/` or `backend/`.
2. Build images with a new tag, for example `v2`.
3. Update `k8s/frontend.yaml` and `k8s/backend.yaml` to that tag.
4. Run `kubectl apply -k k8s`.
5. Wait for rollout status.
6. Test `/` and `/api/health`.
7. Roll back if needed.

## 7. Production Registry Pattern

For a real remote cluster, push images to a registry instead of building only
inside Minikube:

```bash
docker build -t your-dockerhub-user/react-demo:v2 ./frontend
docker build -t your-dockerhub-user/node-demo:v2 ./backend

docker push your-dockerhub-user/react-demo:v2
docker push your-dockerhub-user/node-demo:v2
```

Then use full image names in Kubernetes:

```yaml
image: your-dockerhub-user/react-demo:v2
image: your-dockerhub-user/node-demo:v2
```

## 8. Secret Format: stringData vs base64

For this project, `stringData` is the best format to write in YAML:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-credentials
  namespace: demo-app
type: Opaque
stringData:
  MONGODB_USERNAME: admin
  MONGODB_PASSWORD: Admin@123
```

Kubernetes automatically converts `stringData` into base64 under the Secret's
stored `.data` field.

You can also write the same Secret using base64:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mongodb-credentials
  namespace: demo-app
type: Opaque
data:
  MONGODB_USERNAME: YWRtaW4=
  MONGODB_PASSWORD: QWRtaW5AMTIz
```

But base64 is not encryption. It is only encoding, so anyone can decode it.
For local demo manifests, `stringData` is cleaner and less error-prone.

For production, prefer one of these options:

1. Create the Secret directly in the cluster with `kubectl create secret`.
2. Use an external secret manager.
3. Keep a placeholder example file in git, but never commit real values.

This repo includes `production-secret.example.yaml` at the project root as a
safe production-style example outside the `k8s/` folder. Because it is outside
`k8s/`, it is not applied by `kubectl apply -k k8s`.

Create a production Secret manually:

```bash
kubectl create secret generic mongodb-credentials \
  --from-literal=MONGODB_USERNAME=admin \
  --from-literal=MONGODB_PASSWORD='replace-with-a-strong-password' \
  -n demo-app
```
