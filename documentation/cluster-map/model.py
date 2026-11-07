"""Turns raw kubectl JSON into the cluster map model: pods, Services, identities, storage and who-calls-whom links."""

import re
from dataclasses import asdict, dataclass, field
from urllib.parse import urlsplit

# Infrastructure namespaces; the tables on the page cover every other (workload) namespace.
SYSTEM_NAMESPACES = {"default", "kube-system", "kube-public", "kube-node-lease", "local-path-storage", "ingress-nginx"}
# Pods from these owners in kube-system are listed per node instead of drawn as chips.
NODE_AGENT_OWNERS = {"Node", "DaemonSet"}
API_ACCESS_VOLUME_PREFIX = "kube-api-access-"  # Projected volume Kubernetes injects when a pod gets an API token


@dataclass
class Node:
    """A cluster node (a Docker container in kind)."""

    name: str
    ip: str
    pod_cidr: str
    roles: list[str]
    taints: list[str]
    ingress_ready: bool
    agents: list[str] = field(default_factory=list)


@dataclass
class Pod:
    """A pod with the identity, configuration and storage it uses."""

    id: str
    name: str
    namespace: str
    app: str
    ip: str
    node: str
    host_network: bool
    phase: str
    owner: str
    service_account: str
    token_mounted: bool
    secrets: list[str]
    config_maps: list[str]
    volumes: list[str]
    probes: list[str]


@dataclass
class Service:
    """A Service with the pods it selects and the Ingress hosts that route to it."""

    id: str
    name: str
    namespace: str
    type: str
    cluster_ip: str
    ports: list[str]
    target_ports: list[int]
    dns: str
    scraped: bool
    job: str
    ingress_hosts: list[str]
    cors: bool
    pods: list[str]


@dataclass
class ServiceAccount:
    """A ServiceAccount, the pods running as it and its RBAC permissions."""

    name: str
    namespace: str
    automount: str
    used_by: list[str]
    token_mounted: bool
    permissions: list[str]


@dataclass
class SecretUse:
    """A Secret or ConfigMap and the pods that consume it."""

    kind: str
    name: str
    namespace: str
    keys: list[str]
    used_by: list[str]


@dataclass
class Volume:
    """A PersistentVolumeClaim traced to its PersistentVolume and node."""

    claim: str
    namespace: str
    storage_class: str
    capacity: str
    access_modes: list[str]
    volume: str
    node: str
    path: str
    pods: list[str]


@dataclass
class Link:
    """A connection one pod opens to another."""

    source: str
    target: str
    label: str
    kind: str


def pod_id(item: dict) -> str:
    """Return the namespace/name id of a Kubernetes object."""
    return f"{item['metadata']['namespace']}/{item['metadata']['name']}"


def group_by_kind(items: list[dict]) -> dict[str, list[dict]]:
    """Split a mixed kubectl List into items per kind."""
    groups: dict[str, list[dict]] = {}
    for item in items:
        groups.setdefault(item["kind"], []).append(item)
    return groups


def find_flag(command: list[str], flag: str) -> str:
    """Return the value of --flag=value in a container command, or an empty string."""
    prefix = f"--{flag}="
    return next((part[len(prefix) :] for part in command if part.startswith(prefix)), "")


def owner_kind(item: dict) -> str:
    """Return the controller kind of a pod; a ReplicaSet counts as its Deployment."""
    owners = item["metadata"].get("ownerReferences", [])
    if not owners:
        return "Pod"
    kind = owners[0]["kind"]
    return "Deployment" if kind == "ReplicaSet" else kind


def has_token(spec: dict) -> bool:
    """Return True if the pod has a ServiceAccount API token mounted."""
    return any(volume["name"].startswith(API_ACCESS_VOLUME_PREFIX) for volume in spec.get("volumes", []))


def all_containers(spec: dict) -> list[dict]:
    """Return init and app containers of a pod spec."""
    return spec.get("initContainers", []) + spec.get("containers", [])


def secret_refs(spec: dict) -> list[str]:
    """Describe every Secret a pod reads, as 'secret/key → ENV' or 'secret → volume'."""
    refs = []
    for container in all_containers(spec):
        for env in container.get("env", []):
            ref = env.get("valueFrom", {}).get("secretKeyRef")
            if ref:
                refs.append(f"{ref['name']}/{ref['key']} → {env['name']}")
        refs += [f"{source['secretRef']['name']} → all keys as env" for source in container.get("envFrom", [])]
    refs += [f"{volume['secret']['secretName']} → volume" for volume in spec.get("volumes", []) if "secret" in volume]
    return sorted(set(refs))


def mount_paths(spec: dict) -> dict[str, str]:
    """Map each volume name to the first path it is mounted at."""
    paths: dict[str, str] = {}
    for container in all_containers(spec):
        for mount in container.get("volumeMounts", []):
            paths.setdefault(mount["name"], mount["mountPath"])
    return paths


def describe_volumes(spec: dict) -> tuple[list[str], list[str]]:
    """Return (ConfigMap mounts, other volumes) of a pod; the API token volume is left out."""
    paths = mount_paths(spec)
    config_maps, volumes = [], []
    for volume in spec.get("volumes", []):
        at = paths.get(volume["name"], "?")
        if "configMap" in volume:
            config_maps.append(f"{volume['configMap']['name']} → {at}")
        elif "persistentVolumeClaim" in volume:
            volumes.append(f"PVC {volume['persistentVolumeClaim']['claimName']} at {at}")
        elif "emptyDir" in volume:
            volumes.append(f"emptyDir at {at}")
        elif "hostPath" in volume:
            volumes.append(f"hostPath {volume['hostPath']['path']} at {at}")
    return config_maps, volumes


def describe_probe(kind: str, probe: dict) -> str:
    """Describe one probe, e.g. 'readiness: GET /health :8000'."""
    if "httpGet" in probe:
        return f"{kind}: GET {probe['httpGet'].get('path', '/')} :{probe['httpGet']['port']}"
    if "exec" in probe:
        return f"{kind}: exec {' '.join(probe['exec']['command'])}"
    if "tcpSocket" in probe:
        return f"{kind}: TCP :{probe['tcpSocket']['port']}"
    return f"{kind}: other"


def probes(spec: dict) -> list[str]:
    """Describe the readiness and liveness probes of a pod's app containers."""
    found = []
    for container in spec.get("containers", []):
        for kind in ("readiness", "liveness"):
            probe = container.get(f"{kind}Probe")
            if probe:
                found.append(describe_probe(kind, probe))
    return found


def app_name(labels: dict, fallback: str) -> str:
    """Return the component name from the usual app labels, or fallback."""
    for key in ("app", "app.kubernetes.io/name", "k8s-app", "component"):
        if labels.get(key):
            return labels[key]
    return fallback


def build_pod(item: dict) -> Pod:
    """Build a Pod from a kubectl pod item."""
    spec, status, meta = item["spec"], item.get("status", {}), item["metadata"]
    config_maps, volumes = describe_volumes(spec)
    labels = meta.get("labels", {})
    return Pod(
        id=pod_id(item),
        name=meta["name"],
        namespace=meta["namespace"],
        app=app_name(labels, meta["name"]),
        ip=status.get("podIP", ""),
        node=spec.get("nodeName", ""),
        host_network=spec.get("hostNetwork", False),
        phase=status.get("phase", ""),
        owner=owner_kind(item),
        service_account=spec.get("serviceAccountName", "default"),
        token_mounted=has_token(spec),
        secrets=secret_refs(spec),
        config_maps=config_maps,
        volumes=volumes,
        probes=probes(spec),
    )


def is_node_agent(pod: Pod) -> bool:
    """Return True for kube-system static pods and DaemonSets, which the map lists per node."""
    return pod.namespace == "kube-system" and pod.owner in NODE_AGENT_OWNERS and pod.app != "kube-apiserver"


def build_nodes(items: list[dict], pods: list[Pod]) -> list[Node]:
    """Build Nodes, each with the names of its kube-system agents."""
    nodes = []
    for item in items:
        meta, spec = item["metadata"], item["spec"]
        labels = meta.get("labels", {})
        ip = next((a["address"] for a in item["status"]["addresses"] if a["type"] == "InternalIP"), "")
        agents = sorted({p.app for p in pods if p.node == meta["name"] and is_node_agent(p)})
        nodes.append(
            Node(
                name=meta["name"],
                ip=ip,
                pod_cidr=spec.get("podCIDR", ""),
                roles=sorted(k.split("/", 1)[1] for k in labels if k.startswith("node-role.kubernetes.io/")),
                taints=[f"{t['key']}:{t['effect']}" for t in spec.get("taints", [])],
                ingress_ready=labels.get("ingress-ready") == "true",
                agents=agents,
            )
        )
    return sorted(nodes, key=lambda n: ("control-plane" not in n.roles, n.name))


def selects(selector: dict, labels: dict) -> bool:
    """Return True if a Service selector matches a pod's labels."""
    return bool(selector) and all(labels.get(key) == value for key, value in selector.items())


def ingress_routes(items: list[dict]) -> dict[str, list[tuple[str, bool]]]:
    """Map 'namespace/service' to the (host, CORS enabled) pairs of Ingress rules that route to it."""
    routes: dict[str, list[tuple[str, bool]]] = {}
    for item in items:
        cors = item["metadata"].get("annotations", {}).get("nginx.ingress.kubernetes.io/enable-cors") == "true"
        for rule in item["spec"].get("rules", []):
            for path in rule.get("http", {}).get("paths", []):
                service = path["backend"]["service"]["name"]
                routes.setdefault(f"{item['metadata']['namespace']}/{service}", []).append((rule["host"], cors))
    return routes


def build_services(
    items: list[dict], pod_items: list[dict], routes: dict[str, list[tuple[str, bool]]]
) -> list[Service]:
    """Build Services with their selected running pods and Ingress hosts."""
    services = []
    for item in items:
        meta, spec = item["metadata"], item["spec"]
        annotations = meta.get("annotations", {})
        selector = spec.get("selector", {})
        sid = pod_id(item)
        selected = [
            pod_id(p)
            for p in pod_items
            if p["metadata"]["namespace"] == meta["namespace"]
            and p.get("status", {}).get("phase") == "Running"
            and selects(selector, p["metadata"].get("labels", {}))
        ]
        ports = spec.get("ports", [])
        services.append(
            Service(
                id=sid,
                name=meta["name"],
                namespace=meta["namespace"],
                type=spec.get("type", "ClusterIP"),
                cluster_ip=spec.get("clusterIP", ""),
                ports=[f"{p['port']} → {p.get('targetPort', p['port'])}/{p.get('protocol', 'TCP')}" for p in ports],
                target_ports=[p.get("targetPort", p["port"]) for p in ports],
                dns=f"{meta['name']}.{meta['namespace']}.svc.cluster.local",
                scraped=annotations.get("prometheus.io/scrape") == "true",
                job=annotations.get("prometheus.io/job", ""),
                ingress_hosts=[host for host, _ in routes.get(sid, [])],
                cors=any(cors for _, cors in routes.get(sid, [])),
                pods=sorted(selected),
            )
        )
    return services


def describe_rule(rule: dict) -> str:
    """Describe one RBAC rule, e.g. 'get,list pods,services'."""
    verbs = ",".join(rule.get("verbs", []))
    targets = rule.get("resources", []) + rule.get("nonResourceURLs", [])
    return f"{verbs} {','.join(targets)}"


def permissions_by_account(bindings: list[dict], roles: dict[str, dict]) -> dict[str, list[str]]:
    """Map 'namespace/serviceaccount' to readable permissions from (Cluster)RoleBindings."""
    found: dict[str, list[str]] = {}
    for binding in bindings:
        ref = binding["roleRef"]
        scope = "" if ref["kind"] == "ClusterRole" else binding["metadata"].get("namespace", "") + "/"
        role = roles.get(f"{scope}{ref['name']}", {})
        rules = "; ".join(describe_rule(rule) for rule in role.get("rules", []))
        where = "cluster-wide" if binding["kind"] == "ClusterRoleBinding" else f"in {binding['metadata']['namespace']}"
        for subject in binding.get("subjects") or []:
            if subject["kind"] == "ServiceAccount":
                key = f"{subject['namespace']}/{subject['name']}"
                found.setdefault(key, []).append(f"{ref['kind']} {ref['name']} ({where}): {rules}")
    return found


def role_index(cluster_roles: list[dict], roles: list[dict]) -> dict[str, dict]:
    """Index ClusterRoles by name and Roles by namespace/name."""
    index = {r["metadata"]["name"]: r for r in cluster_roles}
    index.update({pod_id(r): r for r in roles})
    return index


def build_service_accounts(
    items: list[dict], pods: list[Pod], permissions: dict[str, list[str]]
) -> list[ServiceAccount]:
    """Build the workload-namespace ServiceAccounts that at least one pod runs as."""
    accounts = []
    for item in items:
        meta = item["metadata"]
        users = [p for p in pods if p.namespace == meta["namespace"] and p.service_account == meta["name"]]
        if meta["namespace"] in SYSTEM_NAMESPACES or not users:
            continue
        automount = item.get("automountServiceAccountToken")
        accounts.append(
            ServiceAccount(
                name=meta["name"],
                namespace=meta["namespace"],
                automount="not set (true)" if automount is None else str(automount).lower(),
                used_by=sorted(p.name for p in users),
                token_mounted=any(p.token_mounted for p in users),
                permissions=permissions.get(pod_id(item), []),
            )
        )
    return accounts


def referenced_name(ref: str) -> str:
    """Return the object name from a pod reference like 'name/key → ENV' or 'name → /path'."""
    return ref.split(" → ")[0].split("/")[0]


def build_config_uses(secrets: list[dict], config_maps: list[dict], pods: list[Pod]) -> list[SecretUse]:
    """List the workload-namespace Secrets and ConfigMaps that pods consume (key names only, never values)."""
    uses = []
    for kind, items, field_name in (("Secret", secrets, "secrets"), ("ConfigMap", config_maps, "config_maps")):
        for item in items:
            meta = item["metadata"]
            if meta["namespace"] in SYSTEM_NAMESPACES:
                continue
            users = [
                p.name
                for p in pods
                if p.namespace == meta["namespace"]
                and any(referenced_name(ref) == meta["name"] for ref in getattr(p, field_name))
            ]
            if users:
                keys = sorted((item.get("data") or {}).keys())
                uses.append(SecretUse(kind, meta["name"], meta["namespace"], keys, sorted(set(users))))
    return uses


def build_volumes(claims: list[dict], volumes: list[dict], pods: list[Pod]) -> list[Volume]:
    """Trace every PersistentVolumeClaim to its PersistentVolume, node and host path."""
    by_name = {v["metadata"]["name"]: v for v in volumes}
    traced = []
    for claim in claims:
        meta, spec = claim["metadata"], claim["spec"]
        volume = by_name.get(spec.get("volumeName", ""), {})
        volume_spec = volume.get("spec", {})
        terms = volume_spec.get("nodeAffinity", {}).get("required", {}).get("nodeSelectorTerms", [{}])
        expressions = terms[0].get("matchExpressions", [{}]) if terms else [{}]
        path = volume_spec.get("local", {}).get("path") or volume_spec.get("hostPath", {}).get("path", "")
        traced.append(
            Volume(
                claim=meta["name"],
                namespace=meta["namespace"],
                storage_class=spec.get("storageClassName", ""),
                capacity=claim.get("status", {}).get("capacity", {}).get("storage", ""),
                access_modes=spec.get("accessModes", []),
                volume=spec.get("volumeName", ""),
                node=",".join(expressions[0].get("values", [])),
                path=path,
                pods=[p.name for p in pods if any(v.startswith(f"PVC {meta['name']} ") for v in p.volumes)],
            )
        )
    return traced


def referenced_host(value: str) -> tuple[str, int | None]:
    """Return (host, port) from a URL or host[:port] string, or ('', None) if it is neither."""
    try:
        parts = urlsplit(value if "://" in value else f"//{value}")
        return parts.hostname or "", parts.port
    except ValueError:
        return "", None


def resolve_service(value: str, namespace: str, services: dict[str, Service]) -> tuple[Service, str] | None:
    """Find the Service a config value points to, using the same rules as the pod's DNS search list."""
    host, port = referenced_host(value)
    labels = host.split(".")
    if not host or (len(labels) > 2 and labels[2] != "svc"):
        return None
    target_namespace = labels[1] if len(labels) > 1 else namespace
    service = services.get(f"{target_namespace}/{labels[0]}")
    if not service:
        return None
    shown_port = port or (service.ports[0].split(" ")[0] if service.ports else "")
    return service, f"{host}:{shown_port}"


def env_values(spec: dict) -> list[str]:
    """Return the plain (non-secret) env values of every container."""
    return [env["value"] for c in all_containers(spec) for env in c.get("env", []) if "value" in env]


def service_links(source: str, value: str, namespace: str, services: dict[str, Service], kind: str) -> list[Link]:
    """Link source to every pod behind the Service that value refers to."""
    resolved = resolve_service(value, namespace, services)
    if not resolved:
        return []
    service, label = resolved
    return [Link(source, target, label, kind) for target in service.pods if target != source]


def config_links(pod_items: list[dict], services: dict[str, Service]) -> list[Link]:
    """Links from env values that name a Service, e.g. VAULT_ADDR=http://vault-service.vault:8200."""
    links = []
    for item in pod_items:
        for value in env_values(item["spec"]):
            links += service_links(pod_id(item), value, item["metadata"]["namespace"], services, "call")
    return links


def ingress_links(controllers: list[Pod], services: list[Service]) -> list[Link]:
    """Links from the ingress controller to every pod behind a Service with an Ingress host."""
    return [
        Link(controller.id, target, host, "ingress")
        for controller in controllers
        for service in services
        for host in service.ingress_hosts
        for target in service.pods
    ]


def sd_namespaces(prometheus_config: str) -> list[str]:
    """Return the namespaces Prometheus' kubernetes_sd is limited to; empty means all."""
    match = re.search(r"names:\s*\[([^\]]*)\]", prometheus_config)
    return [name.strip() for name in match.group(1).split(",")] if match else []


def scrape_links(
    scrapers: list[Pod], services: list[Service], pods: dict[str, Pod], namespaces: list[str]
) -> list[Link]:
    """Links from Prometheus to every pod behind an annotated Service in its discovery namespaces."""
    links = []
    for service in services:
        if not service.scraped or (namespaces and service.namespace not in namespaces):
            continue
        for target in service.pods:
            address = f"{pods[target].ip}:{service.target_ports[0]}" if service.target_ports else pods[target].ip
            links += [Link(s.id, target, f"scrape {address}/metrics (job {service.job})", "scrape") for s in scrapers]
    return links


def api_links(pods: list[Pod], apiservers: list[Pod], permissions: dict[str, list[str]]) -> list[Link]:
    """Links to the API server from drawn pods that have a token and RBAC permissions."""
    return [
        Link(pod.id, server.id, "Kubernetes API (ServiceAccount token)", "api")
        for pod in pods
        if pod.token_mounted and permissions.get(f"{pod.namespace}/{pod.service_account}") and not is_node_agent(pod)
        for server in apiservers
    ]


def unique_links(links: list[Link]) -> list[Link]:
    """Drop duplicate links (e.g. an init container and app container with the same env)."""
    seen, unique = set(), []
    for link in links:
        key = (link.source, link.target, link.kind)
        if key not in seen:
            seen.add(key)
            unique.append(link)
    return unique


@dataclass
class ClusterFacts:
    """Facts about the cluster that are not in the kubectl object list."""

    context: str
    version: str
    node_network: str
    generated_at: str


@dataclass
class Reference:
    """A Service address configured outside Kubernetes, e.g. Grafana's datasource URL set by Ansible."""

    app: str
    value: str


def reference_links(pods: list[Pod], references: list[Reference], services: dict[str, Service]) -> list[Link]:
    """Links for Service addresses configured outside the pod spec."""
    return [
        link
        for ref in references
        for pod in pods
        if pod.app == ref.app
        for link in service_links(pod.id, ref.value, pod.namespace, services, "call")
    ]


def ingress_placement(controller_items: list[dict], nodes: list[Node]) -> dict:
    """Report where the ingress controller runs and whether it is pinned to the node that owns host port 80."""
    ready_nodes = [n.name for n in nodes if n.ingress_ready]
    running_on = [item["spec"].get("nodeName", "") for item in controller_items]
    pinned = all(item["spec"].get("nodeSelector", {}).get("ingress-ready") == "true" for item in controller_items)
    return {"running_on": running_on, "ingress_ready_nodes": ready_nodes, "pinned": bool(controller_items) and pinned}


def address_ranges(kinds: dict[str, list[dict]], facts: ClusterFacts) -> dict:
    """Return node, pod and Service address ranges."""
    proxy_config = next(
        (
            cm["data"].get("config.conf", "")
            for cm in kinds.get("ConfigMap", [])
            if pod_id(cm) == "kube-system/kube-proxy"
        ),
        "",
    )
    match = re.search(r"clusterCIDR:\s*(\S+)", proxy_config)
    apiserver = next(
        (p for p in kinds.get("Pod", []) if p["metadata"].get("labels", {}).get("component") == "kube-apiserver"), None
    )
    command = apiserver["spec"]["containers"][0].get("command", []) if apiserver else []
    return {
        "nodes": facts.node_network,
        "pods": match.group(1).strip("\"'") if match else "",
        "services": find_flag(command, "service-cluster-ip-range"),
    }


def build_model(items: list[dict], facts: ClusterFacts, references: list[Reference]) -> dict:
    """Build the full cluster map model from a kubectl List of every relevant object."""
    kinds = group_by_kind(items)
    pod_items = kinds.get("Pod", [])
    pods = [build_pod(item) for item in pod_items]
    pods_by_id = {p.id: p for p in pods}
    services = build_services(kinds.get("Service", []), pod_items, ingress_routes(kinds.get("Ingress", [])))
    services_by_id = {s.id: s for s in services}
    roles = role_index(kinds.get("ClusterRole", []), kinds.get("Role", []))
    permissions = permissions_by_account(kinds.get("ClusterRoleBinding", []) + kinds.get("RoleBinding", []), roles)
    nodes = build_nodes(kinds.get("Node", []), pods)

    controller_items = [
        item for item in pod_items if pod_id(item).startswith("ingress-nginx/") and owner_kind(item) == "Deployment"
    ]
    controllers = [pods_by_id[pod_id(item)] for item in controller_items]
    prometheus_config = next(
        (
            cm["data"]["prometheus.yml"]
            for cm in kinds.get("ConfigMap", [])
            if "prometheus.yml" in (cm.get("data") or {})
        ),
        "",
    )
    links = (
        ingress_links(controllers, services)
        + config_links(pod_items, services_by_id)
        + reference_links(pods, references, services_by_id)
        + scrape_links(
            [p for p in pods if p.app == "prometheus"], services, pods_by_id, sd_namespaces(prometheus_config)
        )
        + api_links(pods, [p for p in pods if p.app == "kube-apiserver"], permissions)
    )
    return {
        "generated_at": facts.generated_at,
        "context": facts.context,
        "version": facts.version,
        "system_namespaces": sorted(SYSTEM_NAMESPACES),
        "ranges": address_ranges(kinds, facts),
        "nodes": [asdict(n) for n in nodes],
        "pods": [asdict(p) for p in pods],
        "services": [asdict(s) for s in services],
        "service_accounts": [
            asdict(a) for a in build_service_accounts(kinds.get("ServiceAccount", []), pods, permissions)
        ],
        "config": [asdict(c) for c in build_config_uses(kinds.get("Secret", []), kinds.get("ConfigMap", []), pods)],
        "volumes": [
            asdict(v)
            for v in build_volumes(kinds.get("PersistentVolumeClaim", []), kinds.get("PersistentVolume", []), pods)
        ],
        "links": [asdict(link) for link in unique_links(links)],
        "network_policies": [pod_id(item) for item in kinds.get("NetworkPolicy", [])],
        "ingress": ingress_placement(controller_items, nodes),
    }
