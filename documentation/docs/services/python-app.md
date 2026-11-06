# python-app

Sample backend written in Python with FastAPI. URL: http://python.localhost (API docs at `/docs`).

- Implements the [shared backend contract](../design.md#shared-backend-contract).
- Code: `python-app/src/` — `endpoints.py` (routes), `prometheus_config.py` (metrics middleware),
  `vault_client.py` (secrets, via `hvac`), `logger.py` (logs to stdout).
- Config (env): `VAULT_ADDR`, `VAULT_TOKEN` (required), `VAULT_SECRET_PATH` (default `python-app`).

## Develop

```sh
cd python-app
tox -e tests                                   # unit tests
pip install -r requirements.txt
cd src && VAULT_TOKEN=root uvicorn main:app --reload --port 8000
```

## Redeploy into a running cluster

```sh
docker build -t python-app:dev ./python-app
kind load docker-image python-app:dev --name sample-cluster
kubectl rollout restart deployment python-app
```
