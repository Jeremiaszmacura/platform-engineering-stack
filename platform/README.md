# Platform

Cluster-wide resources applied before any component: the kind cluster config, namespaces and RBAC.
If deleting a component should delete a resource, it belongs in that component's `k8s/` directory instead.

Full docs: [`documentation/docs/platform-decisions.md`](../documentation/docs/platform-decisions.md).
