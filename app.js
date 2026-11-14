/* Elpris — SE3 price & cost tracker for Skövde. Plain JS, no build step. */
(function () {
  "use strict";
  const T = window.Tariff;
  const TZ = "Europe/Stockholm";
  const API = "https://www.elprisetjustnu.se/api/v1/prices/";
  const LS_CFG = "elpris-config", LS_UI = "elpris-ui", LS_ACT = "elpris-actual", LS_DAY = "elpris-day:";
  const app = document.getElementById("app");

  // ---------- formatting (Swedish numbers, Stockholm time) ----------
  const nf = (d) => new Intl.NumberFormat("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2);
  const ore = (v) => `${f1.format(v)} öre`;
  const kr = (v, d = 0) => `${(d ? f2 : f0).format(v)} kr`;
  const oreN = (v) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? f1 : f2).format(v);
  const rate = (v) => `${oreN(v)} öre/kWh`;
  const hm = (pt) => pt.iso.slice(11, 16);
  const endHm = (pt) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(pt.end);
  const dateFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const todayStr = () => dateFmt.format(new Date());
  const weekdayName = (dateStr) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(dateStr + "T12:00:00Z"));
  const monthName = (y, m) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 15)));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- storage ----------
  const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const savedCfg = load(LS_CFG, null);
  let cfg = T.migrateCfg(savedCfg);
  if (!savedCfg || savedCfg.version !== cfg.version) save(LS_CFG, cfg);
  const ui = Object.assign({ mode: "total", day: "today", res: "q", dur: 120, kwh: 1.0, sel: null, settings: false }, load(LS_UI, {}));
  ui.sel = null; ui.settings = false;
  let actual = load(LS_ACT, {});
  const days = {};           // dateStr -> normalized points | null (not published)
  const status = { today: "loading", tomorrow: "loading", month: "idle", error: null, updated: null };
  let today = todayStr();

  // ---------- API ----------
  function url(dateStr) {
    return `${API}${dateStr.slice(0, 4)}/${dateStr.slice(5, 7)}-${dateStr.slice(8, 10)}_${cfg.area}.json`;
  }
  async function fetchDay(dateStr, opts = {}) {
    const key = LS_DAY + cfg.area + ":" + dateStr;
    const cached = load(key, null);
    if (cached && dateStr < today && !opts.force) return T.normalize(cached);
    try {
      const res = await fetch(url(dateStr), { cache: "no-store" });
      if (res.status === 404) return null;              // not published yet
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw) || !raw.length) return null;
      save(key, raw);
      return T.normalize(raw);
    } catch (err) {
      if (cached) return T.normalize(cached);          // offline: last good copy
      throw err;
    }
  }
  function pruneCache() {
    const keep = today.slice(0, 7), prev = T.addDays(today.slice(0, 8) + "01", -1).slice(0, 7);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_DAY)) {
          const d = k.slice(-10);
          if (!d.startsWith(keep) && !d.startsWith(prev) && d < today) localStorage.removeItem(k);
        }
      }
    } catch (e) {}
  }

  async function loadNear() {
    const tomorrow = T.addDays(today, 1);
    // Nord Pool publishes tomorrow around 13:00; don't ask (and log 404s) before 12:30.
    const early = localMinutes() < 12 * 60 + 30;
    const [a, b] = await Promise.allSettled([fetchDay(today), early ? Promise.resolve(null) : fetchDay(tomorrow)]);
    if (a.status === "fulfilled") { days[today] = a.value; status.today = a.value ? "ok" : "missing"; }
    else { status.today = "error"; status.error = a.reason && a.reason.message; }
    if (b.status === "fulfilled") { days[tomorrow] = b.value; status.tomorrow = b.value ? "ok" : "missing"; }
    else { status.tomorrow = "error"; }
    status.updated = Date.now();
    render();
  }
  async function loadMonth() {
    const first = today.slice(0, 8) + "01";
    const todo = [];
    for (let d = first; d < today; d = T.addDays(d, 1)) if (!(d in days)) todo.push(d);
    if (!todo.length) { status.month = "ok"; render(); return; }
    status.month = "loading"; render();
    let failed = 0;
    const worker = async () => {
      while (todo.length) {
        const d = todo.shift();
        try { days[d] = await fetchDay(d); } catch (e) { failed++; }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    status.month = failed ? "partial" : "ok";
    render();
  }

  // ---------- helpers ----------
  function localMinutes() {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date()).split(":").map(Number);
    return h * 60 + m;
  }
  const nowMs = () => Date.now();
  const currentPoint = (pts) => (pts || []).find((p) => p.start <= nowMs() && nowMs() < p.end) || null;
  function upcoming() {
    const a = days[today] || [], b = days[T.addDays(today, 1)] || [];
    return a.concat(b);
  }
  function tier(v, st) {
    const span = st.maxV - st.minV || 1, r = (v - st.minV) / span;
    return r < 0.33 ? "low" : r < 0.66 ? "mid" : "high";
  }

  // ---------- views ----------
  const ICON_SUN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z" fill="currentColor"/></svg>';
  const ICON_GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
  const LOGO = '<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#facc15"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#lg)"/><path d="M36 8 16 36h13l-4 20 22-29H34z" fill="#fff"/></svg>';

  function header() {
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    return `<header class="top">
      <div class="logo">${LOGO}</div>
      <div class="title"><h1>Elpris</h1><p>${esc(cfg.area)} · Skövde · Telinet Kvartspris</p></div>
      <button class="icon-btn" data-action="theme" aria-label="${dark ? "Switch to light mode" : "Switch to dark mode"}">${dark ? ICON_SUN : ICON_MOON}</button>
      <button class="icon-btn" data-action="settings" aria-label="Settings">${ICON_GEAR}</button>
    </header>`;
  }

  function banner() {
    if (status.today === "error") {
      return `<div class="banner error" role="alert"><strong>Can't reach the price service.</strong> ${esc(status.error || "")}
        <button class="btn small" data-action="retry">Try again</button></div>`;
    }
    if (status.today === "missing") return `<div class="banner">Today's prices aren't published for ${esc(cfg.area)} yet.</div>`;
    return "";
  }

  function nowCard() {
    const pts = days[today];
    if (status.today === "loading") return `<section class="card now skeleton"><div class="big">… öre</div><p class="muted">Loading today's prices…</p></section>`;
    const cur = currentPoint(pts);
    if (!cur) return "";
    const b = T.breakdown(cur, cfg), st = T.stats(pts, cfg, ui.mode);
    const v = T.priceOf(cur, cfg, ui.mode), diff = ((v - st.avg) / st.avg) * 100;
    const idx = pts.indexOf(cur), next = pts[idx + 1] || (days[T.addDays(today, 1)] || [])[0];
    const t = tier(v, st), word = { low: "Cheap now", mid: "Normal now", high: "Expensive now" }[t];
    return `<section class="card now">
      <div class="now-head"><span class="pill ${t}">${word}</span><span class="muted">${hm(cur)}–${endHm(cur)}</span></div>
      <div class="big"><span data-test="now-price">${f1.format(v)}</span> <small>öre/kWh</small></div>
      <p class="muted">${ui.mode === "spot" ? "Spot price incl. moms" : "Total price incl. moms"} ·
        ${Math.abs(diff) < 0.5 ? "same as" : `${f0.format(Math.abs(diff))} % ${diff < 0 ? "below" : "above"}`} today's average
        ${next ? ` · next ${hm(next)}: ${f1.format(T.priceOf(next, cfg, ui.mode))}` : ""}</p>
      <div class="parts">
        <span><i class="sw spot"></i>Spot ${f1.format(b.spot)}</span>
        <span><i class="sw grid"></i>Grid ${f1.format(b.grid)}${b.high ? " (peak)" : ""}</span>
        <span><i class="sw tax"></i>Tax ${f1.format(b.tax)}</span>
        <span><i class="sw other"></i>Telinet ${oreN(b.other)}</span>
      </div>
      <p class="faint">Spot excl. moms: ${f1.format(cur.spotEx)} öre/kWh</p>
    </section>`;
  }

  function seg(name, opts, value) {
    return `<div class="seg" role="group">${opts.map(([v, label, dis]) =>
      `<button data-action="set" data-key="${name}" data-val="${v}" aria-pressed="${v === value}" ${dis ? "disabled" : ""}>${label}</button>`).join("")}</div>`;
  }

  function chart(pts) {
    const W = 720, H = 230, L = 40, R = 6, Tp = 12, B = 26;
    const data = ui.res === "h" ? T.hourly(pts) : pts;
    const vals = data.map((p) => T.priceOf(p, cfg, ui.mode));
    const st = T.stats(data, cfg, ui.mode);
    const maxV = Math.max(...vals), minV = Math.min(0, ...vals);
    const step = maxV > 400 ? 100 : maxV > 150 ? 50 : maxV > 60 ? 20 : 10;
    const top = Math.ceil(maxV / step) * step || step;
    const y = (v) => Tp + (H - Tp - B) * (1 - (v - minV) / (top - minV));
    const bw = (W - L - R) / data.length;
    let g = "";
    for (let v = 0; v <= top; v += step) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
    }
    const now = nowMs();
    let bars = "";
    data.forEach((p, i) => {
      const v = vals[i], x = L + i * bw, yy = y(Math.max(v, 0)), h = Math.abs(y(v) - y(0)) || 1;
      const isNow = p.start <= now && now < p.end, past = p.end <= now;
      const cls = `bar ${tier(v, st)}${isNow ? " now" : ""}${past ? " past" : ""}${ui.sel === i ? " sel" : ""}`;
      bars += `<rect class="${cls}" x="${(x + bw * 0.12).toFixed(1)}" y="${(v >= 0 ? yy : y(0)).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bw * 0.3).toFixed(1)}" data-action="pick" data-i="${i}"/>`;
      if (p.iso.slice(14, 16) === "00" && +p.iso.slice(11, 13) % 3 === 0) {
        bars += `<text x="${x}" y="${H - 8}" class="ax">${p.iso.slice(11, 13)}</text>`;
      }
    });
    const nowIdx = data.findIndex((p) => p.start <= now && now < p.end);
    let marker = "";
    if (nowIdx >= 0) {
      const x = L + nowIdx * bw + bw / 2;
      marker = `<line x1="${x}" x2="${x}" y1="${Tp - 4}" y2="${H - B}" class="nowline"/>`;
    }
    const avgLine = `<line x1="${L}" x2="${W - R}" y1="${y(st.avg)}" y2="${y(st.avg)}" class="avgline"/>`;
    const selP = ui.sel != null && data[ui.sel] ? data[ui.sel] : (nowIdx >= 0 ? data[nowIdx] : null);
    const readout = selP
      ? `<b>${hm(selP)}–${endHm(selP)}</b> · ${f1.format(T.priceOf(selP, cfg, ui.mode))} öre/kWh${ui.sel == null ? " (now)" : ""}`
      : "Tap a bar for its price";
    return `<p class="readout" data-test="readout">${readout}</p>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price per ${ui.res === "h" ? "hour" : "quarter-hour"}" data-test="chart">${g}${avgLine}${bars}${marker}</svg>
      <div class="stats">
        <div><span class="faint">Lowest</span><b>${f1.format(st.minV)}</b><span class="muted">${hm(st.min)}</span></div>
        <div><span class="faint">Average</span><b data-test="avg">${f1.format(st.avg)}</b><span class="muted">öre/kWh</span></div>
        <div><span class="faint">Highest</span><b>${f1.format(st.maxV)}</b><span class="muted">${hm(st.max)}</span></div>
      </div>`;
  }

  function dayCard() {
    const tomorrow = T.addDays(today, 1);
    const key = ui.day === "tomorrow" ? tomorrow : today;
    const pts = days[key];
    let body;
    if ((ui.day === "today" ? status.today : status.tomorrow) === "loading") body = `<div class="chart-empty">Loading…</div>`;
    else if (pts && pts.length) body = chart(pts);
    else if (ui.day === "tomorrow") {
      body = `<div class="chart-empty"><b>Tomorrow's prices aren't out yet.</b><br>Nord Pool publishes them around 13:00; this page checks again automatically.</div>`;
    } else body = `<div class="chart-empty">No prices for today.</div>`;
    return `<section class="card">
      <div class="row between wrap gap">
        ${seg("day", [["today", "Today"], ["tomorrow", "Tomorrow"]], ui.day)}
        ${seg("res", [["q", "15 min"], ["h", "Hour"]], ui.res)}
      </div>
      <div class="row between wrap gap mt">
        <h2>${weekdayName(key)}</h2>
        ${seg("mode", [["total", "Total"], ["spot", "Spot"]], ui.mode)}
      </div>
      ${body}
    </section>`;
  }

  const PRESETS = [[60, "1 h"], [120, "2 h · Miele", 1.0], [180, "3 h"], [240, "4 h"]];
  function windowCard() {
    const pts = upcoming();
    let res = "";
    if (!pts.length) res = `<p class="muted">Needs today's prices.</p>`;
    else {
      const w = T.cheapestWindow(pts, ui.dur, ui.kwh, nowMs(), cfg, ui.mode);
      if (!w) res = `<p class="muted">Not enough known prices left for a ${ui.dur / 60} h window. ${status.tomorrow !== "ok" ? "Tomorrow's prices arrive around 13:00." : ""}</p>`;
      else {
        const isTomorrow = w.best.start.iso.slice(0, 10) !== today;
        const startsNow = w.best.startIdx === w.now.startIdx;
        const pct = w.now.costKr > 0 ? (w.savingKr / w.now.costKr) * 100 : 0;
        res = `<div class="win" data-test="window">
          <div class="win-time"><span class="faint">Cheapest start</span>
            <b data-test="win-start">${startsNow ? "Now" : (isTomorrow ? "Tomorrow " : "Today ") + hm(w.best.start)}</b>
            <span class="muted">until ${endHm(w.best.end)} · avg ${ore(w.best.avg)}/kWh</span></div>
          <div class="win-cost"><span class="faint">Cost</span><b>${kr(w.best.costKr, 2)}</b>
            <span class="muted">now: ${kr(w.now.costKr, 2)}</span></div>
        </div>
        <p class="${w.savingKr > 0.005 ? "good" : "muted"}">${w.savingKr > 0.005
          ? `Waiting saves ${kr(w.savingKr, 2)} (${f0.format(pct)} %) for ${f1.format(ui.kwh)} kWh.`
          : "Starting now is already the cheapest option."}
          ${status.tomorrow !== "ok" ? " Tomorrow's prices aren't in yet, so only today is searched." : ""}</p>`;
      }
    }
    return `<section class="card">
      <h2>Cheapest time to run</h2>
      <div class="chips">${PRESETS.map(([m, l, k]) =>
        `<button class="chip" data-action="dur" data-min="${m}" ${k ? `data-kwh="${k}"` : ""} aria-pressed="${ui.dur === m}">${l}</button>`).join("")}</div>
      <label class="inline">Energy use <input type="number" inputmode="decimal" min="0.1" step="0.1" value="${ui.kwh}" data-ui="kwh"> kWh
        <span class="faint">· duration</span> <input type="number" inputmode="numeric" min="15" step="15" max="1440" value="${ui.dur}" data-ui="dur"> min</label>
      ${res}
    </section>`;
  }

  function monthCard() {
    const y = +today.slice(0, 4), m = +today.slice(5, 7), mk = today.slice(0, 7);
    const est = T.monthEstimate(days, y, m, cfg, { actualKwh: +actual[mk] || 0, nowMs: nowMs() });
    const loading = status.month === "loading" ? `<p class="faint">Loading earlier days of the month…</p>` : "";
    if (!est) return `<section class="card"><h2>${monthName(y, m)} estimate</h2>${loading || `<p class="muted">Needs price data.</p>`}</section>`;
    const L = est.lines;
    const row = (label, v, note) => `<tr><td>${label}${note ? `<span class="faint"> ${note}</span>` : ""}</td><td>${kr(v)}</td></tr>`;
    const maxBar = Math.max(est.total, est.compare);
    return `<section class="card">
      <div class="row between"><h2>${monthName(y, m)} estimate</h2><span class="faint">incl. moms</span></div>
      <div class="big" data-test="month-total">${kr(est.total)}</div>
      <p class="muted">${f0.format(est.monthKwh)} kWh ${est.usedActual ? "from your bill" : `estimated (${f0.format(cfg.annualKwh)} kWh/yr × ${f1.format(T.MONTH_WEIGHTS[m - 1] * 100)} %)`}
        · ${f1.format(est.perKwh)} öre/kWh all-in<br>So far: ${f0.format(est.soFar.kwh)} kWh ≈ ${kr(est.soFar.kr)}</p>
      <table class="lines">
        ${row("Electricity (spot)", L.spot, `${f1.format(est.profileSpotInc)} öre avg`)}
        ${row("Telinet påslag", L.other, `${rate(cfg.supplierOtherInc + cfg.supplierMarkupInc)}, moms incl. unconfirmed`)}
        ${row("Telinet monthly fee", L.supplierFee, "0 kr for 24 months, then 69 kr")}
        ${row("Grid fixed fee", L.gridFixed, `${T.GRID_TARIFFS[cfg.fuse] ? T.GRID_TARIFFS[cfg.fuse].code + ", " + cfg.fuse + " A" : ""}`)}
        ${row("Grid transfer", L.gridVar, `${f0.format(est.kwhHigh)} kWh peak-time`)}
        ${L.effekt ? row("Grid power fee", L.effekt, `${f1.format(cfg.peakKw)} kW peak`) : ""}
        ${row("Energiskatt", L.tax)}
        <tr class="sum"><td>Total</td><td>${kr(est.total)}</td></tr>
      </table>
      <div class="cmp" data-test="compare">
        <div class="cmp-row"><span>Telinet</span><div class="cmp-bar"><i style="width:${(est.total / maxBar) * 100}%"></i></div><b>${kr(est.total)}</b></div>
        <div class="cmp-row"><span>${esc(cfg.compareName)}</span><div class="cmp-bar old"><i style="width:${(est.compare / maxBar) * 100}%"></i></div><b>${kr(est.compare)}</b></div>
        <p class="${est.saving > 0 ? "good" : "muted"}">${est.saving >= 0 ? `Telinet saves about ${kr(est.saving)} this month` : `${esc(cfg.compareName)} would be ${kr(-est.saving)} cheaper`}
          <span class="faint">(${esc(cfg.compareName)}: ${f0.format(cfg.compareFeeInc)} kr/mo + ${rate((cfg.compareMarkupInc || 0) + (cfg.compareOtherInc || 0))})</span></p>
      </div>
      <label class="inline">Actual kWh this month (from your bill) <input type="number" inputmode="numeric" min="0" step="1" placeholder="${f0.format(est.estKwh).replace(/\s/g, "")}" value="${actual[mk] || ""}" data-actual="${mk}"></label>
      <p class="faint">Prices known for ${est.knownDays} of ${est.nDays} days; the remaining days use this month's profile-weighted average (${f1.format(est.profileSpotInc)} öre incl. moms, plain average ${f1.format(est.plainSpotInc)}).
        Hourly use follows a typical heat-pump villa profile.${status.month === "partial" ? " Some days could not be loaded." : ""}</p>
      ${loading}
    </section>`;
  }

  const FIELDS = [
    ["annualKwh", "Annual use", "kWh/yr", 100],
    ["peakKw", "Peak hourly power (weekday 06–22, winter)", "kW", 0.1],
    ["energyTaxEx", "Energiskatt", "öre/kWh excl. moms", 0.1],
    ["gridFixedYearEx", "Grid fixed fee", "kr/yr excl. moms", 1],
    ["gridLowEx", "Grid transfer, off-peak", "öre/kWh excl. moms", 0.1],
    ["gridHighEx", "Grid transfer, peak (Nov–Mar weekdays 06–22)", "öre/kWh excl. moms", 0.1],
    ["effektFeeEx", "Grid power fee (Nov–Mar)", "kr/kW/month excl. moms", 1],
    ["supplierFeeInc", "Telinet monthly fee", "kr/month incl. moms", 1],
    ["supplierMarkupInc", "Telinet påslag (elcertifikat), unconfirmed", "öre/kWh (moms incl. unconfirmed)", 0.01],
    ["supplierOtherInc", "Telinet other costs", "öre/kWh incl. moms", 0.1],
    ["compareFeeInc", "GodEl monthly fee", "kr/month incl. moms", 1],
    ["compareOtherInc", "GodEl other costs (elcert etc.)", "öre/kWh incl. moms", 0.1],
    ["compareMarkupInc", "GodEl markup", "öre/kWh incl. moms", 0.1],
    ["vat", "Moms", "%", 1],
  ];
  function settings() {
    if (!ui.settings) return "";
    return `<div class="sheet-backdrop" data-action="close-settings"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="row between"><h2>Settings</h2><button class="btn small" data-action="close-settings">Done</button></div>
      <label class="field"><span>Main fuse (Skövde Energi tariff)</span>
        <select data-cfg="fuse">${Object.entries(T.GRID_TARIFFS).map(([a, t]) =>
          `<option value="${a}" ${cfg.fuse === a ? "selected" : ""}>${a} A · ${t.code}</option>`).join("")}</select></label>
      ${FIELDS.map(([k, label, unit, step]) => `<label class="field"><span>${label}</span>
        <span class="inp"><input type="number" inputmode="decimal" step="${step}" value="${cfg[k]}" data-cfg="${k}"><em>${unit}</em></span></label>`).join("")}
      <p class="faint">Telinet “2 års dynamiskt pris” starts 1 Dec 2026. The monthly fee is 0 kr for 24 months, then 69 kr.
        The 2,24 öre/kWh påslag (elcertifikat) is unconfirmed — the contract does not say whether moms is included. Edit the field when the next invoice shows the figure.</p>
      <p class="faint">Grid and tax figures are Skövde Energi Elnät's and Skatteverket's 2026 rates. Choosing a fuse fills in that tariff.
        Skövde Energi changes its tariff model on 1 Jan 2027 — update these then.</p>
      <div class="row gap"><button class="btn" data-action="reset">Reset to defaults</button></div>
    </section>`;
  }

  function footer() {
    const t = status.updated ? new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(status.updated) : "–";
    return `<footer>Prices from <a href="https://www.elprisetjustnu.se" target="_blank" rel="noopener">Elpriset just nu.se</a> · updated ${t} · times in Swedish time</footer>`;
  }

  function render() {
    const y = window.scrollY;
    app.innerHTML = header() + banner() +
      `<div class="col">${nowCard()}${dayCard()}</div><div class="col">${windowCard()}${monthCard()}</div>` +
      footer() + settings();
    document.body.classList.toggle("locked", ui.settings);
    window.scrollTo(0, y);
  }

  // ---------- events ----------
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("elpris-theme", t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f7f7f5" : "#0b0b0c");
  }
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "theme") setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
    else if (a === "settings") ui.settings = true;
    else if (a === "close-settings") ui.settings = false;
    else if (a === "set") { ui[el.dataset.key] = el.dataset.val; ui.sel = null; }
    else if (a === "pick") { const i = +el.dataset.i; ui.sel = ui.sel === i ? null : i; }
    else if (a === "dur") { ui.dur = +el.dataset.min; if (el.dataset.kwh) ui.kwh = +el.dataset.kwh; }
    else if (a === "retry") { status.today = status.tomorrow = "loading"; render(); loadNear().then(loadMonth); return; }
    else if (a === "reset") { cfg = Object.assign({}, T.DEFAULTS); save(LS_CFG, cfg); }
    save(LS_UI, { mode: ui.mode, day: ui.day, res: ui.res, dur: ui.dur, kwh: ui.kwh });
    render();
  });
  app.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.cfg) {
      const k = el.dataset.cfg;
      if (k === "fuse") {
        const t = T.GRID_TARIFFS[el.value];
        Object.assign(cfg, { fuse: el.value, gridFixedYearEx: t.fixedYear, gridLowEx: t.low, gridHighEx: t.high, effektFeeEx: t.effekt });
      } else {
        const v = parseFloat(String(el.value).replace(",", "."));
        if (isFinite(v) && v >= 0) cfg[k] = v;
      }
      save(LS_CFG, cfg);
    } else if (el.dataset.ui) {
      const v = parseFloat(String(el.value).replace(",", "."));
      if (el.dataset.ui === "kwh" && v > 0) ui.kwh = v;
      if (el.dataset.ui === "dur" && v >= 15) ui.dur = Math.min(1440, Math.round(v / 15) * 15);
      save(LS_UI, { mode: ui.mode, day: ui.day, res: ui.res, dur: ui.dur, kwh: ui.kwh });
    } else if (el.dataset.actual) {
      const v = parseFloat(String(el.value).replace(",", "."));
      if (v > 0) actual[el.dataset.actual] = v; else delete actual[el.dataset.actual];
      save(LS_ACT, actual);
    } else return;
    render();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.settings) { ui.settings = false; render(); } });

  // ---------- timers ----------
  setInterval(() => {
    const t = todayStr();
    if (t !== today) { today = t; status.today = status.tomorrow = "loading"; loadNear().then(loadMonth); return; }
    if (status.tomorrow !== "ok" && localMinutes() >= 12 * 60 + 30 && Date.now() - status.updated > 10 * 60000) { loadNear(); return; }
    if (!ui.settings && !document.activeElement.matches("input,select")) render();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && todayStr() !== today) { today = todayStr(); loadNear().then(loadMonth); }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  pruneCache();
  render();
  loadNear().then(loadMonth);
})();
