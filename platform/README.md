# Platform

Cluster-scoped and shared resources — the kind cluster definition, Namespaces,
and cluster-wide RBAC. Everything that outlives any single service.

**Documentation: [Platform Decisions](https://jeremiaszmacura.github.io/devops-stack/platform-decisions/)**
— source: [`documentation/docs/platform-decisions.md`](../documentation/docs/platform-decisions.md)

All documentation for this repository lives in the MkDocs site; component
directories hold no prose, so a fact is written down in exactly one place.

> If deleting a service should delete the resource, it lives in that service's
> `k8s/` directory. If the resource outlives any single service, it lives here.
