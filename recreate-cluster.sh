#!/bin/bash
# Deletes and recreates the kind cluster with every component. Safe to re-run.
set -euo pipefail

CLUSTER_NAME=sample-cluster

# `yahoo` calls the live API; `fixture` replays recorded prices (used by CI).
STOCK_PROVIDER="${STOCK_PROVIDER:-yahoo}"

# <image> <build context> [Dockerfile]. Docs build from the repo root to include stock-app/openapi.yaml.
IMAGES=(
    "stock-app:dev stock-app"
    "go-app:dev go-app"
    "frontend-app:dev frontend-app"
    "stock-ui:dev stock-ui"
    "documentation:dev . documentation/Dockerfile"
)

# Applied in order, after platform/ (Vault and TimescaleDB before their clients).
COMPONENTS=(
    monitoring/prometheus/k8s
    monitoring/grafana/k8s
    vault/k8s
    timescaledb/k8s
    stock-app/k8s
    go-app/k8s
    frontend-app/k8s
    stock-ui/k8s
    documentation/k8s
)

# Namespaces whose Deployments must become available
NAMESPACES=(apps monitoring vault docs)

# Ingress URLs printed and checked at the end: <name> <url>
URLS=(
    "Frontend http://app.localhost"
    "Stock-UI http://stock-ui.localhost"
    "Stock-app http://stock.localhost"
    "Go-app http://go.localhost"
    "Vault http://vault.localhost"
    "Prometheus http://prometheus.localhost"
    "Grafana http://grafana.localhost"
    "Documentation http://docs.localhost"
)

# Poll url every 2s until curl -f succeeds; warn (never fail) after timeout seconds.
wait_for_url() {
    local name=$1 url=$2 timeout=$3
    until curl -sf -o /dev/null "$url"; do
        if [ "$timeout" -le 0 ]; then
            echo "⚠️  ${name} not reachable at ${url} (check: kubectl get pods -A)"
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
kind create cluster --config platform/kind-cluster.yaml --name "$CLUSTER_NAME"

# Install the ingress controller early so it starts while images build
echo "🌐 Installing ingress-nginx controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.1/deploy/static/provider/kind/deploy.yaml

# Namespaces and cluster-scoped RBAC must exist before any component applies
echo "🏗️  Applying platform resources (namespaces, RBAC)..."
kubectl apply -f platform/namespaces.yaml
kubectl apply -f platform/rbac/

echo "🐳 Building and loading images..."
for entry in "${IMAGES[@]}"; do
    read -r image context dockerfile <<< "$entry"
    docker build -t "$image" -f "${dockerfile:-$context/Dockerfile}" "$context"
    kind load docker-image "$image" --name "$CLUSTER_NAME"
done

# The controller's admission webhook must be up before Ingress resources apply
echo "⏳ Waiting for ingress-nginx controller..."
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=180s

echo "🚀 Deploying components..."
for dir in "${COMPONENTS[@]}"; do
    echo "  ${dir}"
    kubectl apply -f "$dir"
    # stock-app's migration initContainer needs a database that accepts connections
    if [ "$dir" = timescaledb/k8s ]; then
        kubectl rollout status statefulset/timescaledb -n data --timeout=300s
    fi
done

# Idempotent: a no-op when the value already matches the manifest's default
echo "📈 stock-app market data provider: ${STOCK_PROVIDER}"
kubectl set env deployment/stock-app -n apps "STOCK_PROVIDER=${STOCK_PROVIDER}"

echo "⏳ Waiting for deployments and the Vault setup job..."
for ns in "${NAMESPACES[@]}"; do
    kubectl wait --for=condition=available --timeout=300s deployment --all -n "$ns" \
        || echo "⚠️  Some deployments in ${ns} were not ready within 300s"
done
kubectl wait --for=condition=complete --timeout=60s job/vault-configure -n vault \
    || echo "⚠️  vault-configure job did not complete within 60s"

# Completed Job pods are "Succeeded", which is expected
not_running=$(kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded \
    -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}')
if [ -n "$not_running" ]; then
    echo "⚠️  Pods not running:"
    for pod in $not_running; do
        kubectl describe pod "${pod##*/}" -n "${pod%%/*}" | grep -A 10 "Events:" || true
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
