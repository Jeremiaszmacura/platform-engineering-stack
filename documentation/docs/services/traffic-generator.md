# traffic-generator

A React (Vite) page at http://traffic-generator.localhost that simulates traffic in the cluster, for
observability and testing. Pick a stock-app endpoint, send 1–100 concurrent requests, and see every
response; the same traffic shows up in Prometheus and Grafana.

```sh
cd traffic-generator
npm ci && npm run dev    # or npm run build (into dist/)
```
