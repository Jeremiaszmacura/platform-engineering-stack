#!/bin/bash
# Deletes and recreates the local kind cluster with every component.
# Safe to run any number of times.
set -euo pipefail

CLUSTER_NAME=sample-cluster

# Locally built images: <image name> <build directory>
IMAGES=(
    "python-app:dev python-app"
    "go-app:dev go-app"
    "frontend-app:dev frontend-app"
    "documentation:dev documentation"
)

# Manifest directories, applied in this order (Vault before its clients)
COMPONENTS=(
    monitoring/prometheus/k8s
    monitoring/grafana/k8s
    nginx/k8s
    vault/k8s
    python-app/k8s
    go-app/k8s
    frontend-app/k8s
    documentation/k8s
)

# Ingress URLs printed and checked at the end: <name> <url>
URLS=(
    "Frontend http://app.localhost"
    "Python-app http://python.localhost"
    "Go-app http://go.localhost"
    "NGINX http://nginx.localhost"
    "Vault http://vault.localhost"
    "Prometheus http://prometheus.localhost"
    "Grafana http://grafana.localhost"
    "Documentation http://docs.localhost"
)

# Poll a URL every 2s until it answers with a non-error status (curl -f) or
# the timeout (seconds) elapses. Prints a warning on timeout; never fails.
wait_for_url() {
    local name=$1 url=$2 timeout=$3
    until curl -sf -o /dev/null "$url"; do
        if [ "$timeout" -le 0 ]; then
            echo "⚠️  ${name} not reachable at ${url} (check: kubectl get pods)"
            return 0
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    echo "✅ ${name}: ${url}"
}

echo "🔄 Recreating kind cluster..."
# Deletion fails when no cluster exists yet, which is fine
kind delete cluster --name "$CLUSTER_NAME" || true
kind create cluster --config kind-cluster.yaml --name "$CLUSTER_NAME"

# Install the ingress controller early so it starts while images build
echo "🌐 Installing ingress-nginx controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.1/deploy/static/provider/kind/deploy.yaml

echo "🐳 Building and loading images..."
for entry in "${IMAGES[@]}"; do
    read -r image dir <<< "$entry"
    docker build -t "$image" "./$dir"
    kind load docker-image "$image" --name "$CLUSTER_NAME"
done

# The controller's admission webhook must be up before Ingress resources apply
echo "⏳ Waiting for ingress-nginx controller..."
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=180s

echo "🚀 Deploying components..."
for dir in "${COMPONENTS[@]}"; do
    echo "  ${dir}"
    kubectl apply -f "$dir"
done

echo "⏳ Waiting for deployments and the Vault setup job..."
kubectl wait --for=condition=available --timeout=300s deployment --all \
    || echo "⚠️  Some deployments were not ready within 300s"
kubectl wait --for=condition=complete --timeout=60s job/vault-configure \
    || echo "⚠️  vault-configure job did not complete within 60s"

# Completed Job pods are "Succeeded", which is expected
not_running=$(kubectl get pods --field-selector=status.phase!=Running,status.phase!=Succeeded -o name)
if [ -n "$not_running" ]; then
    echo "⚠️  Pods not running:"
    for pod in $not_running; do
        kubectl describe "$pod" | grep -A 10 "Events:" || true
    done
fi

echo "⏳ Checking ingress URLs..."
for entry in "${URLS[@]}"; do
    read -r name url <<< "$entry"
    wait_for_url "$name" "$url" 60
done

echo "📈 Provisioning Grafana datasource and dashboards..."
if curl -sf -o /dev/null http://grafana.localhost/api/health; then
    ansible-playbook monitoring/grafana/ansible/provision.yaml
else
    echo "⚠️  Grafana not reachable; run later: ansible-playbook monitoring/grafana/ansible/provision.yaml"
fi

echo "✅ Cluster ready. Grafana login: admin/admin, Vault token: root"
