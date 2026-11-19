#!/bin/bash
# Deletes the kind cluster with all its data, then recreates it with every component. Safe to re-run.
set -euo pipefail

CLUSTER_NAME=sample-cluster
# Each kind release creates nodes of one Kubernetes version; v0.33 creates 1.37, as in CI. Any patch release works.
KIND_VERSION=v0.33.0

# `yahoo` calls the live API; `synthetic` generates prices without a network (used by CI).
STOCK_PROVIDER="${STOCK_PROVIDER:-yahoo}"

# <image> <build context>
IMAGES=(
    "stock-app:dev stock-app"
    "traffic-generator:dev traffic-generator"
    "stock-ui:dev stock-ui"
    "documentation:dev documentation"
)

# Applied in order, after platform/ (Vault and TimescaleDB before their clients).
COMPONENTS=(
    monitoring/prometheus/k8s
    monitoring/tempo/k8s
    monitoring/otel-collector/k8s
    monitoring/grafana/k8s
    vault/k8s
    timescaledb/k8s
    stock-app/k8s
    traffic-generator/k8s
    stock-ui/k8s
    documentation/k8s
)

# Namespaces whose Deployments, StatefulSets and DaemonSets must finish rolling out
NAMESPACES=(apps monitoring vault docs)

# URLs (all through the shared Gateway) printed and checked at the end: <name> <url>
URLS=(
    "Traffic-generator http://traffic-generator.localhost"
    "Stock-UI http://stock-ui.localhost"
    "Stock-app http://stock.localhost"
    "Vault http://vault.localhost"
    "Prometheus http://prometheus.localhost"
    "Grafana http://grafana.localhost"
    "Documentation http://docs.localhost"
)

# Poll url every 2s until curl -f succeeds; return 1 after timeout seconds.
wait_for_url() {
    local name=$1 url=$2 timeout=$3
    until curl -sf -o /dev/null "$url"; do
        if [ "$timeout" -le 0 ]; then
            return 1
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    echo "✅ ${name}: ${url}"
}

# Print the names of pods in namespace $1 with an unready container, except completed Job pods.
unready_pods() {
    kubectl get pods -n "$1" --no-headers \
        | awk '{ split($2, ready, "/"); if (ready[1] != ready[2] && $3 != "Completed") print $1 }'
}

# Print message $1, then recent events and unready pod logs of each namespace in $2..., and exit 1.
fail() {
    local message=$1 ns pod
    shift
    echo "❌ ${message}"
    for ns in "$@"; do
        echo "--- events: ${ns} ---"
        kubectl get events -n "$ns" --sort-by=.lastTimestamp | tail -n 20 || true
        for pod in $(unready_pods "$ns"); do
            echo "--- logs: ${ns}/${pod} ---"
            kubectl logs "$pod" -n "$ns" --all-containers --tail=30 || true
        done
    done
    exit 1
}

# Exit unless kind has the minor version of KIND_VERSION.
check_kind_version() {
    local found
    found=$(kind version | awk '{ print $2 }')
    if [ "${found%.*}" != "${KIND_VERSION%.*}" ]; then
        echo "❌ kind ${KIND_VERSION%.*}.x is required, found ${found}: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
        exit 1
    fi
}

# Exit if something other than this cluster, which is about to be deleted, listens on host port 80.
check_port_80_free() {
    if docker ps --format '{{.Names}}' | grep -qx "${CLUSTER_NAME}-control-plane"; then
        return 0
    fi
    if (exec 3<>/dev/tcp/127.0.0.1/80) 2>/dev/null; then
        echo "❌ Host port 80 is in use; stop whatever listens on it (sudo lsof -iTCP:80 -sTCP:LISTEN) and re-run"
        exit 1
    fi
}

check_kind_version
check_port_80_free

echo "🔄 Recreating kind cluster..."
# Deletion fails when no cluster exists yet, which is fine
kind delete cluster --name "$CLUSTER_NAME" || true
kind create cluster --config platform/kind-cluster.yaml --name "$CLUSTER_NAME"

# Install the Gateway API controller early so it starts while images build.
# Server-side apply: the bundled Gateway API CRDs are too large for client-side apply.
echo "🌐 Installing Envoy Gateway (Gateway API controller)..."
kubectl apply --server-side -k platform/envoy-gateway

# Namespaces and cluster-scoped RBAC must exist before any component applies
echo "🏗️  Applying platform resources (namespaces, RBAC)..."
kubectl apply -f platform/namespaces.yaml
kubectl apply -f platform/rbac/

echo "🐳 Building and loading images..."
for entry in "${IMAGES[@]}"; do
    read -r image context <<< "$entry"
    docker build -t "$image" "$context"
    kind load docker-image "$image" --name "$CLUSTER_NAME"
done

# The shared Gateway every *.localhost URL enters through; Programmed means its Envoy proxy is running
echo "🚪 Creating the shared Gateway..."
kubectl rollout status deployment/envoy-gateway -n envoy-gateway-system --timeout=180s \
    || fail "envoy-gateway did not finish rolling out within 180s" envoy-gateway-system
kubectl apply -f platform/gateway/
kubectl wait --for=condition=Programmed gateway/shared-gateway -n envoy-gateway-system --timeout=180s \
    || fail "shared-gateway was not Programmed within 180s" envoy-gateway-system

echo "🚀 Deploying components..."
for dir in "${COMPONENTS[@]}"; do
    echo "  ${dir}"
    # A kustomization.yaml builds ConfigMaps from plain config files (e.g. prometheus.yml)
    if [ -f "$dir/kustomization.yaml" ]; then
        kubectl apply -k "$dir"
    else
        kubectl apply -f "$dir"
    fi
    # stock-app's migration initContainer needs a database that accepts connections
    if [ "$dir" = timescaledb/k8s ]; then
        kubectl rollout status statefulset/timescaledb -n data --timeout=300s \
            || fail "timescaledb did not finish rolling out within 300s" data
    fi
done

# Idempotent: a no-op when the value already matches the manifest's default
echo "📈 stock-app market data provider: ${STOCK_PROVIDER}"
kubectl set env deployment/stock-app -n apps "STOCK_PROVIDER=${STOCK_PROVIDER}"

# Rollout status waits for every new pod to be ready, so a crashing new pod fails
# even while an old pod still serves (the Available condition would stay true).
echo "⏳ Waiting for rollouts..."
for ns in "${NAMESPACES[@]}"; do
    for workload in $(kubectl get deployments,statefulsets,daemonsets -n "$ns" -o name); do
        kubectl rollout status "$workload" -n "$ns" --timeout=300s \
            || fail "${workload} in ${ns} did not finish rolling out within 300s" "$ns"
    done
done

echo "⏳ Checking *.localhost URLs..."
for entry in "${URLS[@]}"; do
    read -r name url <<< "$entry"
    wait_for_url "$name" "$url" 60 \
        || fail "${name} not reachable at ${url} within 60s" "${NAMESPACES[@]}" data envoy-gateway-system
done

echo "✅ Cluster ready. Start at http://docs.localhost (Grafana login: admin/admin, Vault token: root)"
