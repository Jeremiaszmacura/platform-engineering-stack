# frontend-app

"API Tester": a small React page (built with Vite) to send test traffic. URL: http://app.localhost

Pick a backend (stock-app or go-app) and one of its endpoints, set how many requests to send at once (1–100),
then send. It shows every answer plus success/failure counts and timings. The traffic then shows up in Grafana.

- stock-app endpoints that need a ticker and a date window (`/bars`, `/summary`) get a symbol and a default
  past window, so repeating a request shows the cache path and a new window shows the provider path.
- Calls the backends directly on their own hosts; their Ingresses allow it with CORS.
- Code: `src/App.jsx` (state), `src/lib/endpoints.js` (backends and endpoints), `src/api/backends.js` (the only
  module that sends requests), `src/components/`. Image: static build served by non-root nginx on port 8080.

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
kubectl rollout restart deployment frontend-app -n apps
```
