# Platform

Cluster-wide resources applied before any component: the kind cluster config, the Gateway API controller
(`envoy-gateway/`) and the shared Gateway (`gateway/`), namespaces and RBAC.
If deleting a component should delete a resource, it belongs in that component's `k8s/` directory instead.

Full docs: [`documentation/docs/design.md`](../documentation/docs/design.md).
