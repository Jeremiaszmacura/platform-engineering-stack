import assert from "node:assert/strict";
import { test } from "node:test";

import { dataEnds } from "../site/assets/js/architecture.js";

test("arrows follow the data, not the connection", () => {
  const ends = (from, to, kind) => dataEnds({ from, to, kind });
  assert.deepEqual(ends("prometheus", "stock-app", "scrape"), { from: "stock-app", to: "prometheus" });
  assert.deepEqual(ends("documentation", "kube-apiserver", "api"), { from: "kube-apiserver", to: "documentation" });
  assert.deepEqual(ends("grafana", "prometheus", "call"), { from: "prometheus", to: "grafana" });
  assert.deepEqual(ends("grafana", "tempo", "call"), { from: "tempo", to: "grafana" });
  assert.deepEqual(ends("otel-collector", "tempo", "call"), { from: "otel-collector", to: "tempo" });
  assert.deepEqual(ends("stock-app", "timescaledb", "call"), { from: "stock-app", to: "timescaledb" });
  assert.deepEqual(ends("envoy", "stock-app", "gateway"), { from: "envoy", to: "stock-app" });
});
