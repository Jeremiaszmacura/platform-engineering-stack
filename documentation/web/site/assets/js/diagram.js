// SVG diagrams drawn from plain data, coloured by CSS variables so both themes work:
// graph() boxes and arrows with live traffic, sequence() message diagrams, journey() a packet moving hop by hop.

import { esc } from "./util.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fit = (text, chars) => (String(text).length > chars ? String(text).slice(0, Math.max(1, chars - 1)) + "…" : String(text));

// ---------- geometry ----------

// Point on side s ("l", "r", "t", "b") of box n at fraction t, with the side's outward normal.
function anchor(n, s, t) {
  if (s === "l") return { x: n.x, y: n.y + n.h * t, nx: -1, ny: 0 };
  if (s === "r") return { x: n.x + n.w, y: n.y + n.h * t, nx: 1, ny: 0 };
  if (s === "t") return { x: n.x + n.w * t, y: n.y, nx: 0, ny: -1 };
  return { x: n.x + n.w * t, y: n.y + n.h, nx: 0, ny: 1 };
}

// The sides two boxes face each other with: left/right when they are further apart sideways than vertically.
function facingSides(a, b) {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX >= gapY) return b.x + b.w / 2 >= a.x + a.w / 2 ? ["r", "l"] : ["l", "r"];
  return b.y + b.h / 2 >= a.y + a.h / 2 ? ["b", "t"] : ["t", "b"];
}

// A wide "bus" box attaches each edge where the other box is, so edges leave it straight.
function busT(bus, other, s) {
  if (s === "t" || s === "b") return clamp((other.x + other.w / 2 - bus.x) / bus.w, 0.03, 0.97);
  return clamp((other.y + other.h / 2 - bus.y) / bus.h, 0.08, 0.92);
}

function cubicPoint(p0, c0, c1, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c0.x + 3 * u * t * t * c1.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c0.y + 3 * u * t * t * c1.y + t * t * t * p1.y,
  };
}

// Straight segments through via points, with rounded corners.
function polyline(points, labelT) {
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, q, r] = [points[i - 1], points[i], points[i + 1]];
    const r1 = Math.min(10, Math.hypot(q.x - p.x, q.y - p.y) / 2);
    const r2 = Math.min(10, Math.hypot(r.x - q.x, r.y - q.y) / 2);
    const into = { x: q.x - Math.sign(q.x - p.x) * r1, y: q.y - Math.sign(q.y - p.y) * r1 };
    const out = { x: q.x + Math.sign(r.x - q.x) * r2, y: q.y + Math.sign(r.y - q.y) * r2 };
    d += ` L${into.x},${into.y} Q${q.x},${q.y} ${out.x},${out.y}`;
  }
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  d += ` L${end.x},${end.y}`;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) * labelT;
  let mid = points[0];
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const f = lengths[i] ? left / lengths[i] : 0;
      mid = { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
      break;
    }
    left -= lengths[i];
  }
  return { d, end, angle: Math.atan2(end.y - before.y, end.x - before.x), mid };
}

function edgeShape(a, b, e) {
  const [sa, sb] = e.sides || facingSides(a, b);
  const p0 = anchor(a, sa, e.ta ?? (a.bus ? busT(a, b, sa) : 0.5));
  const p1 = anchor(b, sb, e.tb ?? (b.bus ? busT(b, a, sb) : 0.5));
  if (e.via) return polyline([p0, ...e.via.map(([x, y]) => ({ x, y })), p1], e.lt ?? 0.5);
  const k = clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.42, 22, 130);
  const c0 = { x: p0.x + p0.nx * k, y: p0.y + p0.ny * k };
  const c1 = { x: p1.x + p1.nx * k, y: p1.y + p1.ny * k };
  return {
    d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`,
    end: p1,
    angle: Math.atan2(p1.y - c1.y, p1.x - c1.x),
    mid: cubicPoint(p0, c0, c1, p1, e.lt ?? 0.5),
  };
}

function arrowHead({ x, y }, angle, size = 9) {
  const back = (da) => `${x - size * Math.cos(angle + da)},${y - size * Math.sin(angle + da)}`;
  return `${x},${y} ${back(0.42)} ${back(-0.42)}`;
}

// Seconds per dash cycle for a rate per second: busier edges flow faster. 0 means no flow.
export function flowSeconds(rate) {
  if (!(rate > 0.004)) return 0;
  return clamp(2.4 / Math.sqrt(rate), 0.35, 5);
}

// ---------- boxes and arrows ----------

function groupSvg(g) {
  return `<g class="grp" style="--c:${g.color}"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="12"/>
    <text x="${g.x + 12}" y="${g.y + 18}">${esc(g.label)}</text></g>`;
}

function nodeSvg(n, classes) {
  const titleChars = Math.floor((n.w - 22 - (n.badge ? 44 : 14)) / 7.6);
  const subChars = Math.floor((n.w - 24) / 6.4);
  const status = n.status ? `<circle class="dot ${n.status}" cx="${n.x + n.w - 13}" cy="${n.y + 14}" r="4.5"/>` : "";
  const badge = n.badge ? `<text class="b" x="${n.x + n.w - 23}" y="${n.y + 18}" text-anchor="end">${esc(n.badge)}</text>` : "";
  const label = `${n.title}${n.sub ? ": " + n.sub : ""}${n.badge ? ", " + n.badge + " ready" : ""}`;
  const interactive = n.click ? ` tabindex="0" role="button" aria-pressed="${classes.includes("sel")}" aria-label="${esc(label)}"` : "";
  return `<g class="nd ${classes}" data-id="${esc(n.id)}" style="--c:${n.color}"${interactive}>
    <title>${esc(n.tip || label)}</title>
    <rect class="box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7"/>
    <rect class="tab" x="${n.x}" y="${n.y}" width="5" height="${n.h}" rx="2"/>
    <text class="t" x="${n.x + 14}" y="${n.y + (n.sub ? 20 : n.h / 2 + 4)}">${esc(fit(n.title, titleChars))}</text>
    ${n.sub ? `<text class="s" x="${n.x + 14}" y="${n.y + 37}">${esc(fit(n.sub, subChars))}</text>` : ""}
    ${status}${badge}</g>`;
}

function labelSvg(text, at, color, hot, dim) {
  const width = text.length * 6.1 + 10;
  return `<g class="lbl${hot ? " hot" : ""}${dim}" style="--c:${color}">
    <rect x="${at.x - width / 2}" y="${at.y - 8}" width="${width}" height="16" rx="4"/>
    <text x="${at.x}" y="${at.y + 3.5}" text-anchor="middle">${esc(text)}</text></g>`;
}

function edgeSvg(e, shape, dim, phaseNow) {
  const flow = flowSeconds(e.flow);
  const delay = flow ? (phaseNow % flow).toFixed(2) : 0;
  return `<g class="ed${e.dashed ? " dashed" : ""}${dim}" style="--c:${e.color}">
    ${e.tip ? `<title>${esc(e.tip)}</title>` : ""}
    <path class="ln" d="${shape.d}"/>
    ${flow ? `<path class="flow" d="${shape.d}" style="--dur:${flow.toFixed(2)}s;animation-delay:-${delay}s"/>` : ""}
    <polygon points="${arrowHead(shape.end, shape.angle)}"/></g>`;
}

function render(spec) {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const edges = spec.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const near = new Set(spec.selected ? [spec.selected] : []);
  for (const e of edges) if (e.from === spec.selected || e.to === spec.selected) near.add(e.from).add(e.to);
  const dimNode = (id) => (spec.selected && !near.has(id) ? " dim" : "");
  const dimEdge = (e) => (spec.selected && e.from !== spec.selected && e.to !== spec.selected ? " dim" : "");
  const phaseNow = performance.now() / 1000;
  const shapes = edges.map((e) => edgeShape(byId.get(e.from), byId.get(e.to), e));
  return `<svg class="dg" viewBox="0 0 ${spec.w} ${spec.h}" role="group" aria-label="${esc(spec.label || "Diagram")}">
    ${(spec.groups || []).map(groupSvg).join("")}
    ${edges.map((e, i) => edgeSvg(e, shapes[i], dimEdge(e), phaseNow)).join("")}
    ${spec.nodes.map((n) => nodeSvg(n, `${n.click ? "click" : ""}${n.id === spec.selected ? " sel" : ""}${n.off ? " off" : ""}${n.dashed ? " dashed" : ""}${dimNode(n.id)}`)).join("")}
    ${edges.map((e, i) => (e.label ? labelSvg(e.label, shapes[i].mid, e.color, e.hot, dimEdge(e)) : "")).join("")}
    ${(spec.notes || []).map((t) => `<text class="note" x="${t.x}" y="${t.y}"${t.anchor ? ` text-anchor="${t.anchor}"` : ""}>${esc(t.text)}</text>`).join("")}
  </svg>`;
}

/**
 * A boxes-and-arrows diagram in container. Call render(spec) with
 * { w, h, label, groups: [{x,y,w,h,label,color}], nodes: [{id,x,y,w,h,title,sub,color,status,badge,click,bus,off}],
 *   edges: [{from,to,label,color,dashed,flow,hot,sides,ta,tb,via,lt,tip}], notes, selected }.
 * onSelect(id) runs when a clickable node is chosen (again: deselect, id null).
 */
export function graph(container, onSelect = () => {}) {
  let current = null;
  const choose = (target) => {
    const node = target.closest(".nd.click");
    if (node) onSelect(current && current.selected === node.dataset.id ? null : node.dataset.id);
  };
  container.addEventListener("click", (ev) => choose(ev.target));
  container.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    if (!ev.target.closest(".nd.click")) return;
    ev.preventDefault();
    choose(ev.target);
  });
  return {
    render(spec) {
      const focused = document.activeElement?.closest?.(".nd")?.dataset.id;
      current = spec;
      container.innerHTML = render(spec);
      if (focused) container.querySelector(`.nd[data-id="${CSS.escape(focused)}"]`)?.focus();
    },
  };
}

// ---------- sequence diagrams ----------

/**
 * A sequence diagram: actors [{id,label,sub,color}] side by side, steps [{from,to,label,note,dashed}] top to bottom.
 * A step from an actor to itself draws a loop.
 */
export function sequence(container, { actors, steps, width = 880, label }) {
  const pad = 80;
  const col = (width - 2 * pad) / Math.max(1, actors.length - 1);
  const xOf = new Map(actors.map((a, i) => [a.id, pad + i * col]));
  const colorOf = new Map(actors.map((a) => [a.id, a.color]));
  const top = 10;
  const rowH = 46;
  const first = top + 64;
  const height = first + steps.length * rowH + 4;
  const boxW = Math.min(210, col - 14);
  const head = actors.map((a) => {
    const x = xOf.get(a.id);
    return `<g class="actor" style="--c:${a.color}"><rect x="${x - boxW / 2}" y="${top}" width="${boxW}" height="40" rx="6"/>
      <text x="${x}" y="${top + (a.sub ? 17 : 25)}" text-anchor="middle">${esc(a.label)}</text>
      ${a.sub ? `<text class="s" x="${x}" y="${top + 31}" text-anchor="middle">${esc(a.sub)}</text>` : ""}</g>
      <line class="life" x1="${x}" y1="${top + 40}" x2="${x}" y2="${height}"/>`;
  });
  const msgs = steps.map((s, i) => {
    const y = first + i * rowH;
    const x1 = xOf.get(s.from);
    const x2 = xOf.get(s.to);
    const color = s.color || colorOf.get(s.from);
    const text = `<tspan class="num">${i + 1}</tspan> ${esc(s.label)}`;
    if (s.from === s.to) {
      return `<g class="msg${s.dashed ? " dashed" : ""}" style="--c:${color}">
        <path d="M${x1},${y} h34 v14 h-28"/><polygon points="${arrowHead({ x: x1 + 4, y: y + 14 }, Math.PI, 7)}"/>
        <text x="${x1 + 42}" y="${y + 5}">${text}</text>
        ${s.note ? `<text class="n" x="${x1 + 42}" y="${y + 19}">${esc(s.note)}</text>` : ""}</g>`;
    }
    const dir = Math.sign(x2 - x1);
    const mid = (x1 + x2) / 2;
    return `<g class="msg${s.dashed ? " dashed" : ""}" style="--c:${color}">
      <path d="M${x1},${y} L${x2 - dir * 2},${y}"/><polygon points="${arrowHead({ x: x2, y }, dir > 0 ? 0 : Math.PI, 8)}"/>
      <text x="${mid}" y="${y - 6}" text-anchor="middle">${text}</text>
      ${s.note ? `<text class="n" x="${mid}" y="${y + 15}" text-anchor="middle">${esc(s.note)}</text>` : ""}</g>`;
  });
  container.innerHTML = `<svg class="dg seq" viewBox="0 0 ${width} ${height + 8}" role="img" aria-label="${esc(label || "Sequence diagram")}">
    ${head.join("")}${msgs.join("")}</svg>`;
}

// ---------- step-through journeys ----------

function journeySvg(hops, at) {
  const width = 920;
  const gap = 34;
  const w = (width - 32 - gap * (hops.length - 1)) / hops.length;
  const h = 56;
  const y = 26;
  const xs = hops.map((_, i) => 16 + i * (w + gap));
  const lo = Math.floor(at);
  const pos = at === lo ? { x: xs[lo] + w / 2, y: y - 9 } : { x: xs[lo] + w + gap / 2, y: y + h / 2 };
  const boxes = hops.map((hop, i) => nodeSvg({ id: `hop-${i}`, x: xs[i], y, w, h, title: hop.title, sub: hop.sub, color: hop.color }, i === lo && at === lo ? "sel" : ""));
  const arrows = hops.slice(1).map((hop, i) => {
    const x1 = xs[i] + w;
    const x2 = xs[i + 1];
    return `<g class="ed" style="--c:${hop.color}"><path class="ln" d="M${x1},${y + h / 2} L${x2},${y + h / 2}"/>
      <polygon points="${arrowHead({ x: x2, y: y + h / 2 }, 0, 8)}"/></g>`;
  });
  return `<svg class="dg" viewBox="0 0 ${width} ${y + h + 12}" role="img" aria-label="Hops of this request">
    ${arrows.join("")}${boxes.join("")}
    <circle class="packet" r="7" cx="0" cy="0" style="transform:translate(${pos.x}px,${pos.y}px)"/></svg>`;
}

/**
 * A request followed hop by hop. update({ hops: [{title,sub,color}], steps: [{at, where, text}] }) redraws it
 * with fresh data and keeps the current step; at is a hop index, or i + 0.5 for the wire between hop i and i+1.
 * Step text is trusted HTML written by this site.
 */
export function journey(container) {
  let spec = null;
  let index = 0;
  let timer = null;
  container.classList.add("journey");
  container.innerHTML = `<div class="scroll-x"></div>
    <div class="controls">
      <button type="button" data-go="-1">← Back</button><button type="button" data-go="1">Next →</button>
      <button type="button" data-play>Play</button><span class="count" aria-live="polite"></span></div>
    <div class="now" aria-live="polite"></div>
    <details class="all-steps"><summary></summary><ol class="steps"></ol></details>`;
  const [stage, , now, all] = container.children;
  const list = all.querySelector("ol");
  const count = container.querySelector(".count");
  const playButton = container.querySelector("[data-play]");

  const stop = () => {
    clearInterval(timer);
    timer = null;
    playButton.textContent = "Play";
  };
  const show = (i) => {
    index = clamp(i, 0, spec.steps.length - 1);
    const step = spec.steps[index];
    const svg = stage.querySelector("svg");
    const fresh = document.createElement("div");
    fresh.innerHTML = journeySvg(spec.hops, step.at);
    const packet = fresh.querySelector(".packet");
    // Move the existing packet so the CSS transition animates it; redraw only the boxes.
    if (svg && svg.querySelector(".packet")) {
      svg.querySelector(".packet").style.transform = packet.style.transform;
      svg.querySelectorAll(".nd").forEach((n, k) => n.classList.toggle("sel", k === step.at));
    } else {
      stage.innerHTML = fresh.innerHTML;
    }
    now.innerHTML = `<span class="where">${esc(step.where)}</span>${step.text}`;
    count.textContent = `Step ${index + 1} of ${spec.steps.length}`;
    list.querySelectorAll("li").forEach((li, k) => (k === index ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current")));
  };
  container.addEventListener("click", (ev) => {
    const go = ev.target.closest("[data-go]");
    const li = ev.target.closest("li");
    if (go) {
      stop();
      show(index + Number(go.dataset.go));
    } else if (ev.target.closest("[data-play]")) {
      if (timer) return stop();
      if (index >= spec.steps.length - 1) show(0);
      playButton.textContent = "Pause";
      timer = setInterval(() => (index >= spec.steps.length - 1 ? stop() : show(index + 1)), 2600);
    } else if (li) {
      stop();
      show(Number(li.dataset.i));
    }
  });
  container.addEventListener("keydown", (ev) => {
    const li = ev.target.closest("li");
    if (li && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      stop();
      show(Number(li.dataset.i));
    }
  });
  return {
    update(next) {
      spec = next;
      stage.innerHTML = journeySvg(spec.hops, spec.steps[Math.min(index, spec.steps.length - 1)].at);
      list.innerHTML = spec.steps
        .map((s, i) => `<li data-i="${i}" tabindex="0"><div><span class="where">${esc(s.where)}</span><span class="what">${s.text}</span></div></li>`)
        .join("");
      all.querySelector("summary").textContent = `Read all ${spec.steps.length} steps`;
      show(index);
    },
  };
}
