# End-to-End Tests

Black-box pytest suite that exercises the running cluster over HTTP, the same
way a user or Prometheus would.

**Documentation: [End-to-End Tests](https://jeremiaszmacura.github.io/devops-stack/e2e-tests/)**
— source: [`documentation/docs/e2e-tests.md`](../documentation/docs/e2e-tests.md)

All documentation for this repository lives in the MkDocs site; component
directories hold no prose, so a fact is written down in exactly one place.

```sh
./recreate-cluster.sh   # deploy the cluster first
make test-e2e           # from the repository root
```
