"""Unit tests for the cluster map model built from kubectl JSON."""

import unittest

import model


def pod(name, namespace="apps", labels=None, env=None, volumes=None, owner="ReplicaSet", ip="10.0.0.1", **spec):
    """Return a minimal kubectl pod item."""
    meta = {"name": name, "namespace": namespace, "labels": labels or {"app": name}}
    if owner:
        meta["ownerReferences"] = [{"kind": owner}]
    container = {"name": name, "env": env or [], "volumeMounts": []}
    return {
        "kind": "Pod",
        "metadata": meta,
        "spec": {"containers": [container], "volumes": volumes or [], "nodeName": "worker", **spec},
        "status": {"phase": "Running", "podIP": ip},
    }


def service(name, namespace="apps", app=None, port=80, target=8080, annotations=None):
    """Return a minimal kubectl Service item selecting app."""
    return {
        "kind": "Service",
        "metadata": {"name": name, "namespace": namespace, "annotations": annotations or {}},
        "spec": {
            "selector": {"app": app or name},
            "clusterIP": "10.96.0.9",
            "ports": [{"port": port, "targetPort": target}],
        },
    }


def ingress(host, service_name, namespace="apps"):
    """Return a minimal kubectl Ingress item routing host to service_name."""
    backend = {"service": {"name": service_name, "port": {"number": 80}}}
    return {
        "kind": "Ingress",
        "metadata": {"name": f"{service_name}-ingress", "namespace": namespace},
        "spec": {"rules": [{"host": host, "http": {"paths": [{"path": "/", "backend": backend}]}}]},
    }


FACTS = model.ClusterFacts(context="kind-test", version="v1.33.1", node_network="172.18.0.0/16", generated_at="now")


class ReferencedHostTest(unittest.TestCase):
    """referenced_host() reads hosts from URLs and host:port values."""

    def test_url_and_plain_host(self):
        """URLs and bare hosts both give a host and optional port."""
        self.assertEqual(model.referenced_host("http://vault-service.vault:8200"), ("vault-service.vault", 8200))
        self.assertEqual(model.referenced_host("timescaledb-service.data"), ("timescaledb-service.data", None))

    def test_values_that_are_not_hosts(self):
        """Paths and invalid ports give no host."""
        self.assertEqual(model.referenced_host("/home/app")[0], "")
        self.assertEqual(model.referenced_host("host:notaport"), ("", None))


class ResolveServiceTest(unittest.TestCase):
    """resolve_service() follows the pod DNS search list rules."""

    def setUp(self):
        """Index two Services built from kubectl items."""
        items = [
            service("vault-service", "vault", port=8200, target=8200),
            service("db", "apps", port=5432, target=5432),
        ]
        self.services = {s.id: s for s in model.build_services(items, [], {})}

    def test_short_name_resolves_in_own_namespace(self):
        """A bare name only finds a Service in the caller's namespace."""
        self.assertEqual(model.resolve_service("db", "apps", self.services)[1], "db:5432")
        self.assertIsNone(model.resolve_service("db", "monitoring", self.services))

    def test_cross_namespace_and_full_names(self):
        """name.namespace and name.namespace.svc.cluster.local reach other namespaces."""
        self.assertEqual(
            model.resolve_service("http://vault-service.vault:8200", "apps", self.services)[0].name, "vault-service"
        )
        self.assertIsNotNone(model.resolve_service("vault-service.vault.svc.cluster.local", "apps", self.services))

    def test_other_values_are_ignored(self):
        """External hosts and plain values are not Services."""
        self.assertIsNone(model.resolve_service("https://query1.finance.yahoo.com", "apps", self.services))
        self.assertIsNone(model.resolve_service("3600", "apps", self.services))


class PodTest(unittest.TestCase):
    """build_pod() extracts identity, secrets and volumes."""

    def test_token_owner_and_references(self):
        """Token volume, Deployment owner, Secret env and volumes are all described."""
        env = [{"name": "DB_PASSWORD", "valueFrom": {"secretKeyRef": {"name": "db-secret", "key": "password"}}}]
        volumes = [
            {"name": "kube-api-access-abcde", "projected": {}},
            {"name": "config", "configMap": {"name": "app-config"}},
            {"name": "tmp", "emptyDir": {}},
        ]
        built = model.build_pod(pod("api", env=env, volumes=volumes))
        self.assertTrue(built.token_mounted)
        self.assertEqual(built.owner, "Deployment")
        self.assertEqual(built.secrets, ["db-secret/password → DB_PASSWORD"])
        self.assertEqual(built.config_maps, ["app-config → ?"])
        self.assertEqual(built.volumes, ["emptyDir at ?"])

    def test_static_pod_without_token(self):
        """A pod owned by a Node is a static pod and has no token without the projected volume."""
        built = model.build_pod(
            pod("kube-apiserver-cp", "kube-system", labels={"component": "kube-apiserver"}, owner="Node")
        )
        self.assertFalse(built.token_mounted)
        self.assertEqual((built.app, built.owner), ("kube-apiserver", "Node"))
        self.assertFalse(model.is_node_agent(built))


class ConfigParsingTest(unittest.TestCase):
    """Small parsers for command flags and Prometheus config."""

    def test_find_flag(self):
        """Returns the flag value or an empty string."""
        command = ["kube-apiserver", "--service-cluster-ip-range=10.96.0.0/16"]
        self.assertEqual(model.find_flag(command, "service-cluster-ip-range"), "10.96.0.0/16")
        self.assertEqual(model.find_flag(command, "missing"), "")

    def test_sd_namespaces(self):
        """Reads the kubernetes_sd namespace list; no list means all namespaces."""
        self.assertEqual(model.sd_namespaces("namespaces:\n  names: [apps, monitoring]"), ["apps", "monitoring"])
        self.assertEqual(model.sd_namespaces("role: endpoints"), [])


class PermissionsTest(unittest.TestCase):
    """permissions_by_account() follows bindings to their roles."""

    def test_cluster_role_binding(self):
        """A ClusterRoleBinding grants its rules cluster-wide to the bound ServiceAccount."""
        roles = {"reader": {"rules": [{"verbs": ["get", "list"], "resources": ["pods"]}]}}
        binding = {
            "kind": "ClusterRoleBinding",
            "metadata": {"name": "reader"},
            "roleRef": {"kind": "ClusterRole", "name": "reader"},
            "subjects": [{"kind": "ServiceAccount", "name": "prom", "namespace": "monitoring"}],
        }
        found = model.permissions_by_account([binding], roles)
        self.assertEqual(found, {"monitoring/prom": ["ClusterRole reader (cluster-wide): get,list pods"]})


class BuildModelTest(unittest.TestCase):
    """build_model() links pods through Ingress, config and scraping."""

    def setUp(self):
        """Build a model of a controller, a scraped backend, a database and Prometheus."""
        backend_env = [{"name": "DB_HOST", "value": "db-service.data"}]
        items = [
            pod("controller", "ingress-nginx", labels={"app.kubernetes.io/name": "ingress-nginx"}, ip="10.0.0.5"),
            pod("api", env=backend_env, ip="10.0.0.6"),
            pod("db", "data", owner="StatefulSet", ip="10.0.0.7"),
            pod("prometheus", "monitoring", ip="10.0.0.8"),
            service("api-service", app="api", annotations={"prometheus.io/scrape": "true", "prometheus.io/job": "api"}),
            service("db-service", "data", app="db", port=5432, target=5432),
            ingress("api.localhost", "api-service"),
        ]
        self.model = model.build_model(items, FACTS, [])
        self.links = {(link["kind"], link["source"], link["target"], link["label"]) for link in self.model["links"]}

    def test_links(self):
        """Ingress, env and scrape links are found."""
        self.assertIn(("ingress", "ingress-nginx/controller", "apps/api", "api.localhost"), self.links)
        self.assertIn(("call", "apps/api", "data/db", "db-service.data:5432"), self.links)
        self.assertIn(
            ("scrape", "monitoring/prometheus", "apps/api", "scrape 10.0.0.6:8080/metrics (job api)"), self.links
        )

    def test_ingress_placement_not_pinned(self):
        """A controller without the ingress-ready nodeSelector is reported as not pinned."""
        self.assertEqual(self.model["ingress"]["running_on"], ["worker"])
        self.assertFalse(self.model["ingress"]["pinned"])

    def test_reference_links(self):
        """Addresses configured outside Kubernetes are linked like env values."""
        refs = [model.Reference(app="api", value="http://db-service.data:5432")]
        rebuilt = model.build_model(
            [pod("api"), pod("db", "data"), service("db-service", "data", app="db")], FACTS, refs
        )
        self.assertEqual([(lnk["source"], lnk["target"]) for lnk in rebuilt["links"]], [("apps/api", "data/db")])


if __name__ == "__main__":
    unittest.main()
