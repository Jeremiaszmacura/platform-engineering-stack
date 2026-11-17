// Without the API (e.g. on GitHub Pages) the pages render assets/snapshot.json instead.

const POLL_MS = 5000;
const TIMEOUT_MS = 8000;
const PROMETHEUS_UI = "http://prometheus.localhost";

/** The current map and where it came from: loading | live | syncing | stale | snapshot | offline. */
export const live = { map: null, source: "loading", error: "", updatedAt: 0 };

const mapListeners = new Set();
const statusListeners = new Set();
let started = false;

/** Call fn(map) with every new map, at once if one is loaded. */
export function onMap(fn) {
  mapListeners.add(fn);
  if (live.map) fn(live.map);
  start();
}

/** Call fn(live) whenever the source or freshness changes. */
export function onStatus(fn) {
  statusListeners.add(fn);
  fn(live);
  start();
}

// Runs fn after ms, or once the tab is visible again: hidden tabs don't poll.
function later(fn, ms) {
  setTimeout(() => {
    if (document.hidden) document.addEventListener("visibilitychange", fn, { once: true });
    else fn();
  }, ms);
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null); // static hosting answers a missing API with an HTML 404
  return { res, body };
}

function setStatus(source, error = "") {
  Object.assign(live, { source, error });
  statusListeners.forEach((fn) => fn(live));
}

function setMap(map, source, error = "") {
  Object.assign(live, { map, updatedAt: Date.now() });
  setStatus(source, error);
  mapListeners.forEach((fn) => fn(map));
}

async function loadSnapshot(reason) {
  try {
    const { res, body } = await getJSON("assets/snapshot.json");
    if (!res.ok || !body) throw new Error(`snapshot: HTTP ${res.status}`);
    setMap(body, "snapshot", reason);
  } catch (err) {
    setStatus("offline", err.message);
  }
}

// One poll; returns false when there is no API to poll at all.
async function poll() {
  try {
    const { res, body } = await getJSON("api/map");
    if (res.ok && body) {
      setMap(body, "live");
      return true;
    }
    if (res.status === 404) {
      if (live.source !== "snapshot") await loadSnapshot("no live API on this host");
      return false;
    }
    throw new Error(body?.error || `HTTP ${res.status}`);
  } catch (err) {
    if (live.map && live.source !== "snapshot") setStatus(live.source === "live" || live.source === "stale" ? "stale" : "syncing", err.message);
    else if (live.source !== "snapshot") await loadSnapshot(err.message);
    return true;
  }
}

function start() {
  if (started) return;
  started = true;
  const loop = async () => {
    if (await poll()) later(loop, POLL_MS);
  };
  loop();
}


/** Whether live queries can work: only with the live API behind this page. */
export const canQuery = () => live.source === "live" || live.source === "stale";

async function prometheus(path, params) {
  const { res, body } = await getJSON(`api/prometheus/api/v1/${path}?${new URLSearchParams(params)}`);
  if (!res.ok || body?.status !== "success") throw new Error(body?.error || `HTTP ${res.status}`);
  return body.data.result;
}

/** Run an instant PromQL query; resolves to Prometheus' result list. */
export const query = (promql) => prometheus("query", { query: promql });

/** Run a range query over the last minutes, one point per step seconds. */
export function queryRange(promql, minutes = 15, step = 15) {
  const end = Math.floor(Date.now() / 1000);
  return prometheus("query_range", { query: promql, start: end - minutes * 60, end, step });
}

/** The value of a one-series instant result, or null when there is no series. */
export const scalar = (result) => (result.length ? Number(result[0].value[1]) : null);

/** A link that opens the query in Prometheus' own UI. */
export const promLink = (promql) =>
  `${PROMETHEUS_UI}/query?${new URLSearchParams({ "g0.expr": promql, "g0.tab": "graph", "g0.range_input": "15m" })}`;

/**
 * Poll a set of named instant queries every everyMs. fn({ name: result | null }, error) runs after each round;
 * error is set when no live cluster is behind the page or Prometheus did not answer.
 */
export function watchQueries(queries, fn, everyMs = POLL_MS) {
  const round = async () => {
    if (!canQuery()) {
      fn({}, "Live metrics need the running cluster.");
    } else {
      const names = Object.keys(queries);
      const settled = await Promise.allSettled(names.map((n) => query(queries[n])));
      const results = Object.fromEntries(names.map((n, i) => [n, settled[i].status === "fulfilled" ? settled[i].value : null]));
      const failed = settled.find((s) => s.status === "rejected");
      fn(results, failed ? `Prometheus did not answer: ${failed.reason.message}` : "");
    }
    later(round, everyMs);
  };
  // The first round waits for the first map: it tells whether a live cluster is behind the page.
  let begun = false;
  onStatus((status) => {
    if (begun || status.source === "loading") return;
    begun = true;
    round();
  });
}
