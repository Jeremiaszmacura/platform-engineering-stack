# frontend-app

A small React page (built with Vite) to send test traffic. URL: http://app.localhost

Pick a backend (python-app or go-app), an endpoint and how many requests (1–100), then send.
It shows each answer plus success/failure counts and average time. The traffic then shows up in Grafana.

- Calls the backends directly on their own hosts; their Ingresses allow it with CORS.
- Code: `frontend-app/src/App.jsx`. Image: static build served by non-root nginx on port 8080.

## Develop

```sh
cd frontend-app
npm ci
npm run dev        # local dev server
npm run build      # production build into dist/
```

## Redeploy into a running cluster

```sh
docker build -t frontend-app:dev ./frontend-app
kind load docker-image frontend-app:dev --name sample-cluster
kubectl rollout restart deployment frontend-app
```
