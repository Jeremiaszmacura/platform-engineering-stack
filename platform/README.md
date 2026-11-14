# Platform

Cluster-wide resources applied before any component: the kind cluster config, the ingress controller, namespaces
and RBAC.
If deleting a component should delete a resource, it belongs in that component's `k8s/` directory instead.

Full docs: [`documentation/docs/design.md`](../documentation/docs/design.md).
