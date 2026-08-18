# Plan: `stock-app` — market data service on TimescaleDB (hexagonal)

Status: **implemented** (2026-07-25) — see §16 for where the implementation
deviates from this plan.
Date: 2026-07-25

## 1. Goal

A new Python service serving standardized daily OHLCV bars to a future React
frontend. Reads from TimescaleDB; calls an external provider (Yahoo Finance now,
Alpha Vantage later) only for data it does not already hold.

Fixed decisions: hexagonal architecture, TimescaleDB, **new service — `python-app`
is not modified**.

- `stock-app/` — image `stock-app:dev`, namespace `apps`, host `http://stock.localhost`
- `timescaledb/` — namespace `data` (new), DNS `timescaledb-service.data:5432`

Out of scope: intraday intervals, continuous aggregates, corporate-actions
history, `postgres_exporter`, authentication, the React app, multi-replica.

## 2. Repo conventions to follow

Read `documentation/docs/design.md` and `platform-decisions.md` first.

- **Resource ownership**: namespaced resources live in `<component>/k8s/`;
  cluster-scoped in `platform/`. So the `data` Namespace goes in
  `platform/namespaces.yaml`, everything else with its component.
- Every manifest sets `metadata.namespace`. Services are `ClusterIP`; host access
  only via Ingress on `*.localhost`.
- Every workload gets its own ServiceAccount with
  `automountServiceAccountToken: false` set **on the SA**. Neither new workload
  needs Kubernetes API access.
- **Prometheus needs no config change** — it discovers targets via
  `kubernetes_sd` over namespaces `[apps, monitoring]`
  (`monitoring/prometheus/k8s/prometheus-config.yaml:26-38`). Annotating the
  Service with `prometheus.io/scrape: "true"` and `prometheus.io/job: stock-app`
  is sufficient.
- **Service discovery for tooling**: the root `Makefile` finds Python services by
  `tox.ini`. Copy `python-app/tox.ini` verbatim; `requirements-dev.txt` contains
  exactly `-r requirements.txt` and `-r ../requirements-dev.txt`.
- **Required shared-config edit**: add `stock-app` to the `files:` regex in
  `/.pre-commit-config.yaml` → `files: ^(python-app|stock-app|e2e)/`. Do not
  create a per-service pre-commit config.
- Service tests use `unittest` + `coverage` under tox; e2e uses pytest. Black
  `--line-length=120`; bandit runs on service code (`# nosec` with a reason where
  needed, as in `python-app/src/vault_client.py:11`).

## 3. Dependencies and provider API

Pin these versions in `requirements.txt`:

```
alembic==1.18.5
fastapi==0.140.0
prometheus_client==0.26.0
psycopg[binary]==3.3.4
pydantic==2.13.4
pydantic-settings==2.14.2
SQLAlchemy==2.0.51
uvicorn==0.51.0
yfinance==1.5.2
```

yfinance pulls pandas/numpy/curl_cffi transitively (~400–500MB image, accepted).
Add `stock-app` to the `docker build` and `kind load` blocks in
`recreate-cluster.sh`. `python:3.14-slim` base is fine for pandas 3.x.

`Ticker.history()` facts that the adapter depends on:

- Index is named `Date` for daily data and is **tz-localized to the exchange
  timezone, not UTC**.
- Call it with **`auto_adjust=False, actions=False`**. This is load-bearing:
  yfinance defaults `auto_adjust=True`, which folds adjustments into `Close` and
  drops `Adj Close` entirely. We need both columns (see §5).
- Columns used: `Open, High, Low, Close, Adj Close, Volume`.
- yfinance is **synchronous** — see the `def`-not-`async def` note in §7.

TimescaleDB image: `timescale/timescaledb:2.28.3-pg17`. Public image, pulled by
the node — no `kind load`.

## 4. Architecture and file structure

Dependency rule, strictly one-way: `adapters → application → domain`.

- `domain/` imports only stdlib and pydantic.
- `application/` imports `domain` and its own `ports`; never an adapter, never
  performs I/O.
- Each adapter owns its own mapping code — no shared `mappers` package.
- `main.py` is the only module that constructs adapters.
- Ports are `typing.Protocol`, not ABCs, so fakes need no inheritance.

Optionally enforce the rule with `import-linter` in `make lint-python` rather
than by review.

```
stock-app/
  Dockerfile  .dockerignore  .coveragerc  README.md
  requirements.txt  requirements-dev.txt  tox.ini
  alembic.ini
  migrations/env.py  migrations/versions/0001_initial_schema.py
  src/
    domain/
      models.py        # PriceBar, Instrument, PriceSummary, DateRange, Interval
      errors.py        # SymbolNotFoundError, ProviderError
    application/
      ports.py         # Protocol MarketDataProvider, PriceBarRepository
      price_history.py # cache-aside use case + missing_range()
    adapters/
      inbound/http/    # routes.py schemas.py deps.py errors.py
      providers/       # yahoo.py
      persistence/     # engine.py tables.py repository.py
    observability/     # logging.py metrics.py
    config.py          # pydantic-settings
    main.py            # composition root
  tests/               # see §12
  k8s/
    stock-app-deployment.yaml    # Deployment + Alembic initContainer + Service
    stock-app-ingress.yaml
    stock-app-secret.yaml        # DB credentials, apps namespace
    stock-app-serviceaccount.yaml

timescaledb/
  README.md
  k8s/
    timescaledb-statefulset.yaml # StatefulSet + Service + volumeClaimTemplates
    timescaledb-secret.yaml      # POSTGRES_PASSWORD, data namespace
    timescaledb-serviceaccount.yaml
```

`python-app`'s Dockerfile uses `COPY src/* .`, which flattens and will break a
package tree. Use `COPY src/ ./src/` with `uvicorn src.main:app`, and make
`tox.ini`'s `PYTHONPATH` match.

## 5. Domain model and standardization

`domain/models.py` — pydantic v2, `ConfigDict(frozen=True)`.

```python
class Interval(StrEnum):
    DAY = "1d"

class PriceBar(BaseModel):
    symbol: str          # normalized: stripped, uppercased
    interval: Interval
    session_date: date   # trading session in the exchange's local calendar
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    adj_close: Decimal | None
    volume: int
```

Validation rules — every bar reaching the database satisfies these regardless of
provider:

| Rule | Kind |
|---|---|
| `symbol` stripped, uppercased, matches `^[A-Z0-9.\-]{1,16}$` | field validator |
| OHLC + `adj_close` → `Decimal` quantized to 4 dp | field validator |
| OHLC `> 0`, `volume >= 0` | field constraint |
| `low <= min(open, close)`, `high >= max(open, close)`, `high >= low` | model validator |
| `session_date` not in the future | model validator |

**Store raw OHLC *and* `adj_close`.** Adjusted prices are rewritten retroactively
by every split and dividend, so the raw column is the only reconcilable one.

**No symbol allowlist.** The regex bounds the symbol's *shape* — and is a
security control, see §11; the provider decides whether it exists
(`SymbolNotFoundError` → 404).

### Cleaning happens in the provider adapter, vectorized

| Step | Operation |
|---|---|
| Drop holiday/halt rows | `df.dropna(subset=["Open","High","Low","Close"])` |
| Exchange-local index → session date | `df.index.tz_convert(tz).date` |
| Deduplicate, keep last | `df[~df.index.duplicated(keep="last")]` |
| Sort chronologically | `df.sort_index()` |
| Round prices | `df[cols].round(4)` |

Domain objects are materialized once at the end; pydantic acts as the final
invariant gate on already-clean data.

Two implementation notes, verified against the pinned versions:

- Hand pandas values straight to the model — pydantic coerces `np.float64` to an
  exact `Decimal` and `np.int64` to `int`. No `.item()` or `Decimal(str(x))`
  needed. `NaN` in a `Decimal`/`int` field raises `ValidationError` on its own.
- `pd.NaT` in a `date` field raises a bare `TypeError`, not `ValidationError`. The
  per-row handler must catch `TypeError`/`ValueError` alongside `ValidationError`
  so a malformed row becomes a counted rejection
  (`stock_provider_rows_rejected_total{provider,reason}`), not a 500.

Per §4, pandas and numpy must not be imported outside `adapters/providers/`.

## 6. Database

`instruments` doubles as the coverage ledger that §7 relies on.

```sql
CREATE TABLE instruments (
    symbol          text PRIMARY KEY,
    name            text,
    exchange        text,
    currency        text,
    first_bar_date  date,
    last_bar_date   date,
    last_synced_at  timestamptz,
    source          text NOT NULL
);

CREATE TABLE price_bars (
    symbol       text          NOT NULL REFERENCES instruments(symbol) ON DELETE CASCADE,
    interval     text          NOT NULL,
    ts           timestamptz   NOT NULL,   -- session date at 00:00:00 UTC
    open         numeric(18,4) NOT NULL,
    high         numeric(18,4) NOT NULL,
    low          numeric(18,4) NOT NULL,
    close        numeric(18,4) NOT NULL,
    adj_close    numeric(18,4),
    volume       bigint        NOT NULL,
    source       text          NOT NULL,
    ingested_at  timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, interval, ts)
);

SELECT create_hypertable('price_bars', by_range('ts', INTERVAL '1 year'),
                         if_not_exists => TRUE);
```

- `ts` holds the session date at UTC midnight; the exchange-local → UTC
  conversion happens in the provider adapter.
- The PK includes `ts` because **TimescaleDB requires the partitioning column in
  every unique index**. It is also the `ON CONFLICT` target for the upsert.
- `chunk_time_interval` of 1 year: the 7-day default would create one
  near-empty chunk per week for daily bars.
- The FK forces write ordering (instrument before bars), which is why the
  repository exposes a single atomic `save_bars`. Drop the FK if it causes
  friction — the use case writes instrument-first anyway.

**Migrations**: Alembic, one initial revision, `create_hypertable` via
`op.execute`. Runs as an `initContainer` on the `stock-app` Deployment using the
same image (`alembic upgrade head`), idempotent via `alembic_version`.

**Access layer**: SQLAlchemy **Core** (`Table` +
`insert().on_conflict_do_update()`), not the ORM — the port returns domain
objects, so an identity map buys nothing. One engine with `pool_pre_ping=True`
and `pool_size=5`; each repository method wraps its work in `with engine.begin()`.

Summary query — `first()`/`last()` are Timescale-specific:

```sql
SELECT first(close, ts) AS first_close, last(close, ts) AS last_close,
       max(high) AS period_high, min(low) AS period_low,
       avg(volume) AS avg_volume, count(*) AS bar_count
FROM price_bars
WHERE symbol = :symbol AND interval = :interval AND ts >= :start AND ts <= :end;
```

## 7. Ports and the cache-aside use case

```python
class MarketDataProvider(Protocol):
    name: str
    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]: ...
    def fetch_instrument(self, symbol: str) -> Instrument: ...

class PriceBarRepository(Protocol):
    def get_instrument(self, symbol: str) -> Instrument | None: ...
    def list_instruments(self) -> list[Instrument]: ...
    def bars_in_range(self, symbol: str, interval: Interval, start: date, end: date) -> list[PriceBar]: ...
    def save_bars(self, instrument: Instrument, bars: Sequence[PriceBar]) -> int: ...
    def summarize(self, symbol: str, interval: Interval, start: date, end: date) -> PriceSummary | None: ...
```

```
get_price_history(symbol, start, end):
    symbol   = normalized(symbol)
    coverage = repo.get_instrument(symbol)

    fetch_range = missing_range(coverage, start, end)   # None => fully cached
    if fetch_range is not None:
        instrument = provider.fetch_instrument(symbol)      # raises SymbolNotFoundError
        bars       = provider.fetch_daily_bars(symbol, fetch_range.start, fetch_range.end)
        repo.save_bars(instrument.with_coverage(bars, now), bars)   # one transaction
        source = "provider"
    else:
        source = "cache"

    return PriceHistory(bars=repo.bars_in_range(symbol, DAY, start, end), source=source, ...)
```

**Cache completeness cannot be decided by row count** — markets close on weekends
and holidays, so 30 calendar days is ~21 bars and the number varies by exchange.
The ledger records *how far we synced*, never *how many bars to expect*.

`missing_range` — pure function in `application/`, the core thing to unit-test:

| Coverage state | Fetch range |
|---|---|
| No instrument row | `[start, end]` |
| `start < first_bar_date` | `[start, end]` — backward extension |
| `end` reaches the unsettled edge and `now - last_synced_at > STALE_AFTER` | `[last_bar_date, end]` — tail refresh |
| Inside `[first_bar_date, last_bar_date]`, not touching the unsettled edge | `None` — cache hit |

- **At most one provider call per request**: when both ends are missing, widen to
  one contiguous window instead of fetching a gap list.
- `STALE_AFTER` defaults to 1h (`STOCK_STALE_AFTER_SECONDS`). Today's bar mutates
  intraday and closes get revised by adjustments, so the trailing edge refetches
  once stale; older bars always come from cache.

`PriceHistoryService` takes both ports via its constructor, so its tests need no
database and no network. yfinance and SQLAlchemy Core are both synchronous, so
**every route stays `def`, not `async def`** — FastAPI's threadpool keeps the
event loop unblocked. Matches `python-app`'s style.

## 8. HTTP API

All under `/api/v1`. Response models use
`alias_generator=to_camel, populate_by_name=True`. Prices serialize as JSON
**numbers** — convert `Decimal` → `float` in the response schema, since pydantic
renders `Decimal` as a string and chart libraries will not accept that.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/instruments` | Symbols held, with coverage — frontend picker |
| `GET` | `/api/v1/instruments/{symbol}/bars?start=…&end=…` | Cache-aside endpoint |
| `GET` | `/api/v1/instruments/{symbol}/summary?start=…&end=…` | Period analytics |
| `GET` | `/health` | Readiness probe; reports database reachability |
| `GET` | `/metrics` | Prometheus exposition |

`start` and `end` are both **required** inclusive ISO session dates — no `days`
shorthand, no implicit "end defaults to today". Validate in one request model so
FastAPI returns 422 before the use case runs:

- `start <= end`
- `end` not in the future
- `(end - start).days <= MAX_RANGE_DAYS` (default 3650)

```json
{
  "symbol": "AAPL",
  "interval": "1d",
  "currency": "USD",
  "source": "provider",
  "range": { "start": "2026-06-25", "end": "2026-07-24" },
  "count": 21,
  "bars": [
    { "date": "2026-06-25", "open": 201.5, "high": 203.1, "low": 200.9,
      "close": 202.4, "adjClose": 202.4, "volume": 41230100 }
  ]
}
```

`date` is emitted as a bare `"2026-07-24"`, not `…T00:00:00Z` — the latter makes
`toLocaleDateString()` render the previous day for viewers west of UTC.

Error mapping in `adapters/inbound/http/errors.py`, the only place domain errors
meet HTTP: `SymbolNotFoundError` → 404, `ProviderError` → 502, repository failure
→ 503, request validation → 422 (FastAPI default).

## 9. Kubernetes

Add the `data` namespace to `platform/namespaces.yaml`.

**`timescaledb/k8s/`**
- StatefulSet, 1 replica, `timescale/timescaledb:2.28.3-pg17`.
- Env `POSTGRES_DB=stockdata`, `POSTGRES_USER=stockapp`, `POSTGRES_PASSWORD` from
  `secretKeyRef`, and `PGDATA=/var/lib/postgresql/data/pgdata` — **required**, the
  mount point itself must not be the data directory.
- `volumeClaimTemplates`: 2Gi, default `standard` StorageClass (kind's
  local-path). Generates PVC `data-timescaledb-0`, which survives pod restarts
  but not `kind delete cluster` — so the database is always cold after
  `recreate-cluster.sh`.
- Readiness and liveness: `exec pg_isready -U stockapp -d stockdata`.
- Service `timescaledb-service` on 5432, `ClusterIP`, **no Ingress**.

**`stock-app/k8s/`**
- Deployment in `apps`, `serviceAccountName: stock-app`, `stock-app:dev`,
  `imagePullPolicy: IfNotPresent`, `readinessProbe` on `/health`.
- `initContainers: [{name: migrate, image: stock-app:dev, command: [alembic, upgrade, head]}]`,
  same env as the app container.
- Env: `STOCK_DB_HOST=timescaledb-service.data` (cross-namespace, hence `.data`),
  `STOCK_DB_PORT`, `STOCK_DB_NAME`, `STOCK_DB_USER`, `STOCK_DB_PASSWORD` from
  `secretKeyRef`, `STOCK_PROVIDER=yahoo`, `STOCK_STALE_AFTER_SECONDS=3600`.
- Service `stock-app-service:8000`, `ClusterIP`, annotated
  `prometheus.io/scrape: "true"` and `prometheus.io/job: stock-app`.
- Ingress host `stock.localhost` with
  `nginx.ingress.kubernetes.io/enable-cors: "true"`.

**Secrets are namespace-scoped and cannot be referenced across namespaces**, so
the DB password exists as two manifests with the same literal — one in `data`
(server), one in `apps` (client). Note it in both READMEs with Vault as the
eventual single source.

**`recreate-cluster.sh`** — after the Vault block, before python-app:

```sh
echo "  🗄️  Deploying TimescaleDB..."
kubectl apply -f timescaledb/k8s/
kubectl rollout status statefulset/timescaledb -n data --timeout=300s

echo "  📈 Deploying Stock app..."
kubectl apply -f stock-app/k8s/
```

The explicit `rollout status` matters twice: it gives the Alembic initContainer a
live database, and the existing readiness loop only waits on `deployment --all`,
which would skip a StatefulSet. Also add `data` to that loop, add
`wait_for_url "Stock app" http://stock.localhost 30`, add the URL to the final
summary, and add `data` to the failure-dump namespace list in
`.github/workflows/e2e.yaml`.

## 10. Observability

Copy `python-app`'s `PrometheusMiddleware` — services are self-contained, and the
repo has no shared-package mechanism. **Log to stdout only**, no file handler
(diverging from `python-app` deliberately; note it in the README).

| Metric | Labels |
|---|---|
| `stock_provider_requests_total` | `provider`, `outcome` (`success`/`not_found`/`error`) |
| `stock_provider_request_duration_seconds` | `provider` |
| `stock_cache_lookups_total` | `outcome` (`hit`/`miss`/`refresh`) |
| `stock_bars_upserted_total` | `provider` |
| `stock_provider_rows_rejected_total` | `provider`, `reason` |

**Never label a metric by `symbol`** — symbols come from untrusted request paths,
so it is an unbounded-cardinality DoS vector, not just untidy.

New dashboard `monitoring/grafana/ansible/dashboards/stock-app.json` (cache hit
ratio, provider latency, provider error rate, bars ingested) — picked up
automatically by `deploy-dev.yaml`.

## 11. Security

| Concern | Mitigation |
|---|---|
| SQL injection | SQLAlchemy Core bound parameters only, never f-string SQL; `symbol` regex-validated in the domain first |
| Provider-abuse amplification via an unauthenticated endpoint | Span bounded by `MAX_RANGE_DAYS`; future `end` rejected; symbol regex prevents URL injection; one provider call per request max; ledger absorbs repeats. Add `nginx.ingress.kubernetes.io/limit-rps` if abused |
| Metric cardinality DoS | No `symbol` label (§10); unmatched routes collapse to a constant label in the copied middleware |
| Credentials | Kubernetes Secret, same posture as `grafana-admin-secret`. Base64, **not** encrypted — dev playground only |
| Future Alpha Vantage API key | Vault, via the existing `services/<service>/<key>` layout — never a manifest or image |
| Container hardening | Non-root `USER`; `allowPrivilegeEscalation: false`; `readOnlyRootFilesystem: true` where the runtime permits |
| Supply chain | yfinance is an unofficial scraper shipping `curl_cffi` (TLS impersonation). Pin exactly; bandit covers the service; the port allows replacing it |
| CORS | `enable-cors` at the Ingress. Scope `cors-allow-origin` to the frontend host once it has a fixed origin |

## 12. Tests

### Unit — `stock-app/tests/`, `unittest` under `tox -e tests`

| File | Covers |
|---|---|
| `test_domain_models.py` | Every §5 rule: symbol normalization, 4-dp quantization, OHLC cross-field violations, negative volume, future `session_date` |
| `test_price_history.py` | Use case against in-memory fakes: full miss, cache hit, backward extension, stale-tail refresh, fresh-tail no-refetch, `SymbolNotFoundError`, `ProviderError`. Plus `missing_range` in isolation — where the weekend/holiday correctness lives |
| `test_yahoo_provider.py` | DataFrame fixture → `list[PriceBar]`, **no network**: exchange-tz → session date, all-NaN rows dropped, `Adj Close` mapped, dedupe, ordering. A `NaN` price and a `NaT` index entry each become a counted rejection, not an escaping exception |
| `test_routes.py` | `TestClient` + `dependency_overrides` (as in `python-app/tests/test_endpoints.py`): response shape, camelCase keys, 404/502/503/422, every `start`/`end` rule |
| `test_config.py` | Settings parsing and database URL assembly |

`TimescalePriceBarRepository` needs a real Postgres and is **not** unit-tested —
upsert idempotency, hypertable writes and the summary query are covered by e2e.
`testcontainers` would close the gap; deferred.

### End-to-end — `e2e/tests/test_stock_workflows.py`

Add `stock-app` to `SERVICE_URLS` in `e2e/cluster.py`. Do **not** add it to
`BACKENDS` — that fixture is the python-app/go-app shared contract, which
stock-app does not implement.

Cases: unknown symbol → 404; cold request reports `source: "provider"`; immediate
repeat reports `source: "cache"`; bars ascending, non-empty,
`low <= close <= high`; summary agrees with the bars it summarizes;
`/api/v1/instruments` lists the symbol; `stock_cache_lookups_total` increments;
Prometheus shows the `stock-app` target up (extend `test_monitoring_pipeline.py`).

**Yahoo rate-limits datacenter IPs, and CI runs the full suite on every PR.**
Register an `external` marker in `e2e/pytest.ini`, mark the provider-touching
tests with it, and run CI with `-m "not external"`. If CI coverage of the stock
pipeline becomes necessary, add a `FakeMarketDataProvider` selected by
`STOCK_PROVIDER=fake` — cheap because the port already exists.

```sh
cd stock-app && tox -e tests     # this service only
make test-unit-python            # all Python services
make lint-python
./recreate-cluster.sh && make test-e2e
```

## 13. Documentation to update

- `design.md` — add both components to the table, routing diagram, namespace list
  (`data`) and deployment order. State that stock-app does **not** implement the
  python-app/go-app shared contract.
- **New** `stock-data.md` — purpose, hexagonal layout, how to add a provider,
  the cache-aside algorithm and coverage ledger, API contract, schema.
- `platform-decisions.md` — `data` namespace, StatefulSet + PVC, cross-namespace
  Secret duplication.
- `monitoring.md` — the five metrics and the dashboard.
- `e2e-tests.md` — the `external` marker.
- `getting-started.md` + root `README.md` — `stock.localhost`.
- `mkdocs.yml` — add the new page to `nav`.
- New `stock-app/README.md` and `timescaledb/README.md`.

## 14. Acceptance criteria

1. `./recreate-cluster.sh` on a clean machine brings up `timescaledb` (Running,
   PVC Bound) and `stock-app` (Ready), Alembic initContainer completing.
2. Two consecutive runs both succeed; the second migration is a no-op.
3. `GET /api/v1/instruments/AAPL/bars?start=2026-06-01&end=2026-06-30` returns 200
   with `source: "provider"` on a cold database; an immediate repeat returns
   `source: "cache"` with an identical `bars` array.
4. The cached path makes zero outbound provider calls —
   `stock_provider_requests_total` does not increment.
5. Every `price_bars` row satisfies the §5 invariants: no NaN, no duplicate
   `(symbol, interval, ts)`, `numeric` prices, both `close` and `adj_close` populated.
6. A 30-calendar-day window containing holidays returns fewer than 30 bars and
   does **not** trigger a refetch on the second call.
7. Unknown symbol → 404. Missing `start`/`end`, `start > end`, future `end`, and a
   span over `MAX_RANGE_DAYS` → 422.
8. Prometheus shows `stock-app` up, all five metrics present, dashboard renders.
9. No `symbol` label on any metric.
10. `make lint-python` and `make test-unit-python` pass with `stock-app`
    auto-discovered.
11. `make test-e2e` passes; the non-`external` subset passes in CI.
12. `python-app`, `go-app`, `frontend-app` and all 40 existing e2e tests are
    untouched and still pass.
13. `domain/` and `application/` import no FastAPI, SQLAlchemy, yfinance, pandas,
    numpy or `os`; `test_domain_models.py` and `test_price_history.py` pass with
    pandas uninstalled.
14. §13 documentation updated and the MkDocs site builds.

## 15. Implementation order

1. Scaffold: dirs, `tox.ini`, `requirements*.txt`, pre-commit regex, Dockerfile.
   Verify `make test-unit-python` discovers the service.
2. `domain/` + `test_domain_models.py` — no I/O, fastest feedback.
3. `application/` + `test_price_history.py` with fakes — the whole use case is
   provable before a database exists.
4. `config.py`, `observability/`.
5. `adapters/persistence/` + Alembic revision, against a throwaway
   `docker run timescale/timescaledb`.
6. `adapters/providers/yahoo.py` + fixture tests.
7. `adapters/inbound/http/` + `main.py` + `test_routes.py`.
8. `timescaledb/k8s/`, `platform/namespaces.yaml`, `stock-app/k8s/`,
   `recreate-cluster.sh`.
9. e2e tests, Grafana dashboard.
10. Documentation.

## 16. Deviations from this plan

Recorded during implementation; each one is a correction, not a shortcut.

1. **The coverage ledger stores the *synced* window, not bar dates.**
   `first_bar_date`/`last_bar_date` became `first_synced_date`/`last_synced_date`
   and are set from the fetched range rather than from the returned bars.
   Storing bar dates breaks acceptance criterion 6: a window starting on a
   Saturday gets `first_bar_date = Monday`, so `start < first_bar_date` fires on
   every repeat and refetches forever. §7's own rule — "the ledger records how
   far we synced" — is what the columns now hold.
2. **`PriceBarRepository` gained `check_health()`.** `/health` has to report
   database reachability (§8) without the route importing SQLAlchemy.
3. **`PrometheusMiddleware` lives in `adapters/inbound/http/middleware.py`,**
   not in `observability/metrics.py`. The application layer reports cache
   outcomes into `metrics.py`, so that module must not import FastAPI, or
   acceptance criterion 13 fails.
4. **`GET /` was added.** `e2e/tests/test_cluster_health.py` asserts 200 on
   every `SERVICE_URLS` entry, and FastAPI answers 404 at `/` by default.
5. **`requirements-dev.txt` also pins `httpx`,** exactly as `python-app` does.
   `fastapi.testclient.TestClient` does not work without it, so §12's route
   tests could not run.
6. **`MAX_RANGE_DAYS` is a module constant, not a setting.** §9's env list does
   not include it, and a pydantic query validator cannot read settings.
7. **`data` was not added to the `deployment --all` readiness loop.** That
   namespace holds no Deployment, so `kubectl wait` exits immediately with
   "no matching resources found" and prints a spurious warning on every run.
   The explicit `kubectl rollout status statefulset/timescaledb` covers it.
8. **`FakeMarketDataProvider` was not built.** §12 makes it conditional
   ("if CI coverage becomes necessary"). Instead, the request-validation,
   readiness, metrics and instrument-listing e2e tests are unmarked and do run
   in CI; only the nine provider-touching cases carry `external`.
9. **`make test-e2e` takes `E2E_PYTEST_ARGS`.** CI needs `-m "not external"`
   and the target hardcoded its pytest invocation.
10. **The dependency rule is machine-enforced.** §4 offered `import-linter` as
    optional; it is now wired in. `stock-app/.importlinter` declares four
    contracts and `tox -e pre-commit` runs `lint-imports` after the hooks, so
    `make lint-python` fails on an import pointing the wrong way. Verified by
    temporarily adding `import os`, `import pandas` and an adapter import to
    `domain/models.py` — all four contracts broke, naming file and line.
11. **e2e provider tests choose their own window instead of a fixed one.**
    §12 assumed a cold store ("cold request reports `source: provider`"), which
    only holds on the first run after `recreate-cluster.sh`: the TimescaleDB PVC
    survives a pod restart, so the second `make test-e2e` found the window
    already cached. The `unsynced_period` fixture reads the ledger over the API
    and starts before its earliest synced date, forcing a backward extension.
    Three consecutive runs against the same warm cluster now pass.
12. **Tooling revs bumped** (2026-07-26): `pre-commit-hooks` v4.5.0 → v6.0.0,
    `black` 23.1.0 → 26.5.1, `bandit` 1.7.7 → 1.9.4, and the root
    `requirements-dev.txt` pins to current `coverage`/`pre_commit`/`tox`. This
    fixes a real trap: black 23.1.0 crashes with
    `module 'ast' has no attribute 'Str'` on Python 3.12+ whenever it needs to
    *reformat* a file, so new unformatted code failed the lint with a
    misleading error instead of being fixed. A duplicated
    `requirements-txt-fixer` hook entry was also removed.
13. **`stock-data.md` no longer exists** (2026-07-26). All repository
    documentation moved into a `Services` section of the MkDocs site, one page
    per deployed component. §13's `stock-data.md` became
    `documentation/docs/services/stock-app.md` (merged with the old
    `stock-app/README.md`, including the hexagonal ring diagram), and the
    TimescaleDB half became `documentation/docs/services/timescaledb.md`.
    Component `README.md` files are now stubs pointing at their page.
