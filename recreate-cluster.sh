#!/bin/bash
set -euo pipefail

# Market data provider stock-app is deployed with. `yahoo` calls the real API;
# `fixture` replays the recording baked into the image, which is what CI uses
# because Yahoo rate-limits datacenter IPs. See documentation/docs/e2e-tests.md.
STOCK_PROVIDER="${STOCK_PROVIDER:-yahoo}"

# Poll an URL every 2s until it answers over HTTP or the timeout (seconds)
# elapses; prints a success line or a warning, never fails the script.
wait_for_url() {
    local name=$1 url=$2 timeout=$3
    echo "  Checking ${name}..."
    while ! curl -s "$url" > /dev/null && [ "$timeout" -gt 0 ]; do
        sleep 2
        timeout=$((timeout-2))
    done
    if [ "$timeout" -le 0 ]; then
        echo "⚠️  Warning: ${name} not accessible at ${url}"
        echo "   Check service and pod status with: kubectl get pods,services"
        return 0
    fi
    echo "✅ ${name} is accessible"
}

echo "🔄 Recreating Kind cluster..."

# Cleanup and create cluster; deletion may fail when no cluster exists yet
kind delete cluster --name sample-cluster || true
kind create cluster --config platform/kind-cluster.yaml --name sample-cluster

# Install the ingress controller early so it starts while images build
echo "🌐 Installing ingress-nginx controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.1/deploy/static/provider/kind/deploy.yaml

# Namespaces and cluster-scoped RBAC must exist before any component applies
echo "🏗️  Applying platform resources (namespaces, RBAC)..."
kubectl apply -f platform/namespaces.yaml
kubectl apply -f platform/rbac/

# Build and load application images
echo "🐳 Building and loading Docker images..."
docker build -t go-app:dev ./go-app
docker build -t stock-app:dev ./stock-app
# From the repository root: the site renders stock-app's OpenAPI contract by
# reading the service's own file, so that file has to be in the build context.
docker build -t mkdocs-documentation:dev -f documentation/Dockerfile .
docker build -t frontend-app:dev ./frontend-app
docker build -t stock-ui:dev ./stock-ui

kind load docker-image go-app:dev --name sample-cluster
kind load docker-image stock-app:dev --name sample-cluster
kind load docker-image mkdocs-documentation:dev --name sample-cluster
kind load docker-image frontend-app:dev --name sample-cluster
kind load docker-image stock-ui:dev --name sample-cluster

# The controller's admission webhook must be up before Ingress resources apply
echo "⏳ Waiting for ingress-nginx controller..."
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=180s

# Deploy applications in order
echo "🚀 Deploying applications..."

# Deploy monitoring (Prometheus, then Grafana)
echo "  📊 Deploying Prometheus..."
kubectl apply -f monitoring/prometheus/k8s/

echo "  📈 Deploying Grafana..."
kubectl apply -f monitoring/grafana/k8s/

# Deploy web services
echo "  🌐 Deploying NGINX..."
kubectl apply -f nginx/k8s/

# Vault must exist before the backends that use it for secrets
echo "  🔐 Deploying Vault..."
kubectl apply -f vault/k8s/

# TimescaleDB must accept connections before stock-app's Alembic initContainer
# runs. The readiness loop further down only waits on Deployments, which would
# skip a StatefulSet, so wait for the rollout explicitly here.
echo "  🗄️  Deploying TimescaleDB..."
kubectl apply -f timescaledb/k8s/
kubectl rollout status statefulset/timescaledb -n data --timeout=300s

echo "  📈 Deploying Stock app (provider: ${STOCK_PROVIDER})..."
kubectl apply -f stock-app/k8s/
# Idempotent: no-op when the value already matches the manifest's default.
kubectl set env deployment/stock-app-deployment -n apps "STOCK_PROVIDER=${STOCK_PROVIDER}"

echo "  🔧 Deploying Go app..."
kubectl apply -f go-app/k8s/

echo "  ⚛️  Deploying Frontend App..."
kubectl apply -f frontend-app/k8s/

echo "  📉 Deploying Stock UI..."
kubectl apply -f stock-ui/k8s/

echo "  📚 Deploying documentation..."
kubectl apply -f documentation/k8s/

# Wait for deployments to be ready
echo "⏳ Waiting for deployments to be ready..."
for ns in apps monitoring vault docs; do
    kubectl wait --for=condition=available --timeout=300s deployment --all -n "$ns" \
        || echo "⚠️  Warning: some deployments in ${ns} did not become ready within 300s"
done

# Check for any failed pods (Succeeded covers completed Jobs like vault-configure)
echo "🔍 Checking pod status..."
failed_pods=$(kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded \
    -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{"\n"}{end}')
if [ ! -z "$failed_pods" ]; then
    echo "⚠️  Some pods are not running:"
    kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
    echo ""
    echo "📋 Pod details:"
    for pod in $failed_pods; do
        echo "--- Pod: $pod ---"
        kubectl describe pod "${pod##*/}" -n "${pod%%/*}" | grep -A 10 -B 5 "Events:" || true
        echo ""
    done
fi

# Wait for services to be accessible
echo "⏳ Waiting for services to be accessible..."
wait_for_url "Grafana" http://grafana.localhost 60
wait_for_url "Vault" http://vault.localhost 30

# The backends store secrets in the services/ KV mount created by this job
echo "⏳ Waiting for Vault KV mounts (services/, infra/)..."
kubectl wait --for=condition=complete --timeout=60s job/vault-configure -n vault || echo "⚠️  Warning: vault-configure job did not complete within 60s"
wait_for_url "Stock app" http://stock.localhost 30
wait_for_url "Frontend app" http://app.localhost 30
wait_for_url "Stock UI" http://stock-ui.localhost 30
wait_for_url "Documentation" http://docs.localhost 30

# Deploy Grafana dashboards only if Grafana is accessible
if curl -s http://grafana.localhost > /dev/null; then
    echo "🚀 Deploying dashboards to DEV environment..."
    ansible-playbook monitoring/grafana/ansible/deploy-dev.yaml
else
    echo "⚠️  Skipping dashboard deployment - Grafana not accessible"
    echo "   Run the following command manually once Grafana is ready:"
    echo "   ansible-playbook monitoring/grafana/ansible/deploy-dev.yaml"
fi

# Show service URLs
echo ""
echo "🎉 Cluster ready! Services available at:"
echo "  📊 Prometheus: http://prometheus.localhost"
echo "  📈 Grafana: http://grafana.localhost"
echo "  🌐 NGINX: http://nginx.localhost"
echo "  🔐 Vault: http://vault.localhost"
echo "  🔧 Go App: http://go.localhost"
echo "  📈 Stock App: http://stock.localhost"
echo "  ⚛️  Frontend App: http://app.localhost"
echo "  📉 Stock UI: http://stock-ui.localhost"
echo "  📚 Documentation: http://docs.localhost"
echo ""

echo "✅ Cluster setup complete!"