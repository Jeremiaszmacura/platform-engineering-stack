# nginx

A sample web server (2 replicas) at http://nginx.localhost, showing how to monitor software you don't own:
each pod has an `nginx-exporter` sidecar that reads nginx's `stub_status` (localhost only) and exposes
metrics on port 9113, scraped per pod through `nginx-metrics-service`.
