// PAGES below is the only list of pages: documentation/web/embed_test.go checks it against the files.

import { $, $$, currentPage, esc } from "./util.js";
import { live, onMap, onStatus } from "./live.js";
import { explainTerms } from "./terms.js";
import { initComments } from "./comments.js";

/** Every page, in reading order. */
export const PAGES = [
  { group: "Start", items: [
    { href: "index.html", title: "Overview", note: "The whole cluster, live" },
    { href: "map.html", title: "Cluster map", note: "Where every pod runs" },
  ] },
  { group: "Learn", items: [
    { href: "networking.html", title: "Networking", note: "Gateway, Services, DNS, packets" },
    { href: "security.html", title: "Identity & secrets", note: "RBAC, Secrets, Vault, hardening" },
    { href: "observability.html", title: "Observability", note: "Metrics, alerts, traces and logs" },
    { href: "state.html", title: "State & storage", note: "Volumes, StatefulSets, caches" },
    { href: "workloads.html", title: "Workloads", note: "Controllers, probes, rollouts" },
  ] },
  { group: "Reference", items: [
    { href: "components.html", title: "Components", note: "Every service, with live specs" },
    { href: "delivery.html", title: "Build & ship", note: "Run, test, CI, add a component" },
    { href: "design.html", title: "Design decisions", note: "What we chose and why" },
  ] },
];

const ORDER = PAGES.flatMap((g) => g.items);

const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
  <rect x="1" y="1" width="24" height="7" rx="2" fill="var(--ns-gateway)"/>
  <rect x="1" y="10" width="11" height="15" rx="2" fill="var(--ns-apps)"/>
  <rect x="14" y="10" width="11" height="7" rx="2" fill="var(--ns-data)"/>
  <rect x="14" y="19" width="11" height="6" rx="2" fill="var(--ns-monitoring)"/></svg>`;

const SUN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MENU = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`;

function topbar() {
  const bar = $("#topbar");
  bar.innerHTML = `<button class="icon-btn menu-btn" type="button" aria-label="Menu" aria-expanded="false">${MENU}</button>
    <a class="brand" href="index.html">${LOGO}<b>Platform Engineering Stack</b><span>live field guide</span></a>
    <span class="spacer"></span>
    <span class="pill" id="live-pill" data-source="loading"><i></i><span class="label">connecting…</span></span>
    <button class="icon-btn" type="button" id="theme" aria-label="Switch between light and dark theme">${SUN}</button>`;
  const menu = $(".menu-btn", bar);
  menu.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    menu.setAttribute("aria-expanded", String(open));
  });
  $("#theme").addEventListener("click", toggleTheme);
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("theme", root.dataset.theme);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

function sidebar() {
  const page = currentPage();
  $("#sidebar").innerHTML = `<nav aria-label="Chapters">${PAGES.map((g) => `<div class="group"><span class="eyebrow">${esc(g.group)}</span>
    ${g.items.map((p) => `<a href="${p.href}"${p.href === page ? ' aria-current="page"' : ""}>${esc(p.title)}<small>${esc(p.note)}</small></a>`).join("")}</div>`).join("")}
    <div class="hosts" id="hosts"><span class="eyebrow">Open in the cluster</span></div></nav>`;
  // The hostnames the Gateway accepted right now, so the list never offers a route that isn't there.
  onMap((map) => {
    const hosts = map.routes.filter((r) => r.accepted).flatMap((r) => r.hostnames).sort();
    $("#hosts").innerHTML = `<span class="eyebrow">Open in the cluster</span>${hosts.map((h) => `<a href="http://${esc(h)}" target="_blank" rel="noopener">${esc(h)}</a>`).join("")}`;
  });
}

function pageContents() {
  const target = $("#toc");
  if (!target) return;
  target.innerHTML = $$("section.chapter[id]").map((s) => `<a href="#${s.id}">${esc($("h2", s)?.textContent || s.id)}</a>`).join("");
}

function pager() {
  const i = ORDER.findIndex((p) => p.href === currentPage());
  const prev = ORDER[i - 1];
  const next = ORDER[i + 1];
  const nav = document.createElement("nav");
  nav.className = "pager";
  nav.setAttribute("aria-label", "Previous and next chapter");
  nav.innerHTML = (prev ? `<a href="${prev.href}"><span class="eyebrow">Previous</span><b>${esc(prev.title)}</b></a>` : "<span></span>")
    + (next ? `<a class="next" href="${next.href}"><span class="eyebrow">Next</span><b>${esc(next.title)}</b></a>` : "");
  const foot = document.createElement("p");
  foot.className = "site-footer";
  foot.id = "site-footer";
  $("article.page").append(nav, foot);
}

function copyButtons() {
  for (const block of $$(".cmd")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      const text = $("pre", block).textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        getSelection().selectAllChildren($("pre", block));
        button.textContent = "Selected";
      }
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    block.append(button);
  }
}

const ago = (ms) => `${Math.max(0, Math.round((Date.now() - ms) / 1000))}s ago`;

function statusText(s) {
  if (s.source === "live") return `live · updated ${ago(s.updatedAt)}`;
  if (s.source === "stale") return `stale · ${ago(s.updatedAt)}`;
  if (s.source === "syncing") return "syncing with the API…";
  if (s.source === "snapshot") return `snapshot · ${new Date(s.map.generated_at).toLocaleDateString()}`;
  if (s.source === "offline") return "offline";
  return "connecting…";
}

function liveStatus() {
  const pill = $("#live-pill");
  const paint = () => {
    pill.dataset.source = live.source;
    $(".label", pill).textContent = statusText(live);
    pill.title = live.source === "snapshot"
      ? "No live cluster behind this page: showing a recorded copy of the cluster map."
      : live.error || "Data from the Kubernetes API, through the documentation service.";
  };
  onStatus(paint);
  setInterval(paint, 1000);
  onStatus((s) => {
    const foot = $("#site-footer");
    if (foot && s.map) {
      foot.innerHTML = s.source === "snapshot"
        ? `Showing a recorded snapshot of the cluster (${esc(new Date(s.map.generated_at).toLocaleString())}).`
        : `Live from the Kubernetes API of cluster <code>${esc(s.map.context || "?")}</code> (Kubernetes ${esc(s.map.version)}), through the <code>documentation</code> service.`;
    }
    snapshotBanner(s);
  });
}

// Readers of the published copy (GitHub Pages) learn why nothing moves, and how to make it move.
function snapshotBanner(s) {
  const existing = $("#snapshot-banner");
  if (s.source !== "snapshot") return existing?.remove();
  if (existing) return;
  const banner = document.createElement("p");
  banner.className = "callout";
  banner.id = "snapshot-banner";
  banner.innerHTML = `<b>Recorded snapshot.</b> No cluster is behind this copy of the site, so diagrams and tables show the cluster as
    it was on ${esc(new Date(s.map.generated_at).toLocaleDateString())} and live traffic is off. Run <code>./recreate-cluster.sh</code>
    and open <a href="http://docs.localhost">docs.localhost</a> to explore your own cluster live.`;
  $(".page-head")?.after(banner);
}

topbar();
sidebar();
pageContents();
pager();
copyButtons();
liveStatus();
explainTerms($("article.page"));
initComments($("article.page")); // after the term marks, so a comment mark never splits a term
