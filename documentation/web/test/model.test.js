import assert from "node:assert/strict";
import { test } from "node:test";

import { appLinks, brokenRoutes, components, health, nodeShort, restricted, shortName } from "../site/assets/js/model.js";
import { flowSeconds } from "../site/assets/js/diagram.js";

const locked = { non_root: true, no_privilege_escalation: true, drops_all_capabilities: true, seccomp: true, host_access: [], added_capabilities: [] };

const pod = (id, app, extra = {}) => {
  const [namespace, name] = id.split("/");
  return { id, name, namespace, app, owner: "Deployment", phase: "Running", ready: true, restarts: 0, images: [], hardening: locked, ...extra };
};

const map = {
  system_namespaces: ["kube-system", "envoy-gateway-system"],
  pods: [
    pod("apps/api-7d9f8c6b5-x2k4p", "api", { images: ["api:dev"] }),
    pod("apps/api-7d9f8c6b5-q8w2e", "api", { ready: false, restarts: 2, images: ["api:dev"] }),
    pod("data/db-0", "db", { owner: "StatefulSet" }),
    pod("kube-system/coredns-1", "kube-dns"),
    pod("envoy-gateway-system/proxy-1", "envoy"),
  ],
  services: [{ id: "apps/api-service", name: "api-service", namespace: "apps", pods: ["apps/api-7d9f8c6b5-x2k4p"], hostnames: ["api.localhost"], scraped: true, job: "api" }],
  links: [
    { source: "apps/api-7d9f8c6b5-x2k4p", target: "data/db-0", label: "db-service.data:5432", kind: "call" },
    { source: "apps/api-7d9f8c6b5-q8w2e", target: "data/db-0", label: "db-service.data:5432", kind: "call" },
    { source: "envoy-gateway-system/proxy-1", target: "apps/api-7d9f8c6b5-x2k4p", label: "api.localhost", kind: "gateway" },
  ],
  routes: [
    { id: "apps/api-route", accepted: true, status: "Accepted" },
    { id: "data/db-route", accepted: false, status: "not accepted: NotAllowedByListeners" },
  ],
};

test("short names drop the hashes controllers add", () => {
  assert.equal(nodeShort("sample-cluster-worker2"), "worker2");
  assert.equal(nodeShort("sample-cluster-control-plane"), "control-plane");
  assert.equal(shortName(map.pods[0]), "api");
  assert.equal(shortName({ name: "kube-proxy-x7k2p", owner: "DaemonSet" }), "kube-proxy");
  assert.equal(shortName({ name: "etcd-sample-cluster-control-plane", owner: "Node", node: "sample-cluster-control-plane" }), "etcd");
});

test("health counts ready pods and treats finished Jobs as done", () => {
  assert.deepEqual(health(map.pods.slice(0, 2)), { total: 2, ready: 1, restarts: 2, state: "warn", done: 0 });
  assert.equal(health([pod("a/x", "x", { ready: false })]).state, "bad");
  assert.deepEqual(health([pod("vault/job-abcde", "job", { owner: "Job", phase: "Succeeded" })]), { total: 0, ready: 0, restarts: 0, state: "ok", done: 1 });
  assert.equal(health([]).state, "none");
});

test("components group workload pods by app, outside the system namespaces", () => {
  const list = components(map);
  assert.deepEqual(list.map((c) => c.app), ["api", "db"]);
  assert.deepEqual(list[0].hostnames, ["api.localhost"]);
  assert.deepEqual(list[0].jobs, ["api"]);
  assert.deepEqual(list[0].images, ["api:dev"]);
});

test("app links merge pod links per pair of apps and kind", () => {
  assert.deepEqual(appLinks(map), [
    { from: "api", to: "db", kind: "call", labels: ["db-service.data:5432"] },
    { from: "envoy", to: "api", kind: "gateway", labels: ["api.localhost"] },
  ]);
});

test("broken routes are the ones not fully accepted", () => {
  assert.deepEqual(brokenRoutes(map).map((r) => r.id), ["data/db-route"]);
});

test("the restricted profile allows only NET_BIND_SERVICE back", () => {
  assert.equal(restricted(pod("a/x", "x")), true);
  assert.equal(restricted(pod("a/x", "x", { hardening: { ...locked, added_capabilities: ["NET_BIND_SERVICE"] } })), true);
  assert.equal(restricted(pod("a/x", "x", { hardening: { ...locked, added_capabilities: ["IPC_LOCK"] } })), false);
  assert.equal(restricted(pod("a/x", "x", { hardening: { ...locked, host_access: ["hostNetwork"] } })), false);
  assert.equal(restricted(pod("a/x", "x", { hardening: { ...locked, seccomp: false } })), false);
  assert.equal(restricted({ id: "a/old" }), false);
});

test("busier edges flow faster, and idle ones don't move", () => {
  assert.equal(flowSeconds(0), 0);
  assert.equal(flowSeconds(null), 0);
  assert.ok(flowSeconds(10) < flowSeconds(1));
  assert.equal(flowSeconds(10000), 0.35);
});
