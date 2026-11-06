# nginx

A sample web server (2 replicas) that answers `Hello from NGINX`. URL: http://nginx.localhost

It shows how to monitor software you don't own:

- Each nginx pod has an `nginx-exporter` sidecar. It reads nginx's `stub_status` page over localhost
  and exposes Prometheus metrics on port 9113.
- `stub_status` only allows localhost, so it is not reachable from outside the pod.
- Prometheus scrapes every pod through the annotated Service `nginx-metrics-service` (namespace `apps`), one target per pod.

`stub_status` gives connection counts and total requests — not response codes or latency.

Files: `nginx/k8s/nginx-config.yaml` (server config), `nginx/k8s/nginx-deployment.yaml` (pods, Services).
