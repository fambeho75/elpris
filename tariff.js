/* Elpris — pure tariff, price and estimate logic (no DOM).
   Works in the browser (window.Tariff) and in Node (require) for tests.
   All money inside is computed EXCLUDING moms and converted at the end. */
(function (root) {
  "use strict";

  // Skövde Energi Elnät, säkringskunder, gäller från 2026-01-01 (exkl. moms).
  // https://skovdeenergi.se/elnat/elnatstaxa-utan-moms/
  const GRID_TARIFFS = {
    "16": { code: "N14E", fixedYear: 1285, low: 4.9, high: 22, effekt: 66 },
    "20": { code: "N15E", fixedYear: 2150, low: 4.9, high: 22, effekt: 66 },
    "25": { code: "N16E", fixedYear: 2425, low: 4.9, high: 22, effekt: 66 },
    "35": { code: "N17E", fixedYear: 2985, low: 4.9, high: 19, effekt: 110 },
    "50": { code: "N18E", fixedYear: 3490, low: 4.9, high: 19, effekt: 110 },
    "63": { code: "N19E", fixedYear: 4450, low: 4.9, high: 19, effekt: 110 },
  };

  const DEFAULTS = {
    version: 2,
    area: "SE3",
    vat: 25,                    // moms %
    energyTaxEx: 36.0,          // energiskatt 2026, öre/kWh exkl. moms (Skatteverket)
    fuse: "20",                 // huvudsäkring, A
    gridFixedYearEx: 2150,      // kr/år exkl. moms
    gridLowEx: 4.9,             // öre/kWh exkl. moms, låglast
    gridHighEx: 22,             // öre/kWh exkl. moms, höglast (nov–mar, vardag 06–22)
    effektFeeEx: 66,            // kr/kW/månad exkl. moms, höglastmånader
    peakKw: 4.5,                // estimated highest hourly kW on a weekday 06–22 in winter
    supplierFeeInc: 0,          // Telinet kr/mån inkl. moms; 0 for 24 months from 2026-12-01, then 69
    supplierMarkupInc: 2.24,    // Telinet påslag elcertifikat öre/kWh; UNCONFIRMED whether moms is included
    supplierOtherInc: 0,        // no separate "övriga kostnader" on this contract
    compareName: "GodEl",
    compareFeeInc: 49,          // GodEl kr/mån inkl. moms
    compareMarkupInc: 0,        // GodEl påslag öre/kWh inkl. moms
    compareOtherInc: 6.0,       // GodEl "övriga kostnader" SE3, öre/kWh inkl. moms
    annualKwh: 8500,
  };

  const KEEP_ON_MIGRATE = [
    "area", "vat", "energyTaxEx", "fuse", "gridFixedYearEx", "gridLowEx", "gridHighEx",
    "effektFeeEx", "peakKw", "annualKwh",
  ];

  /** Merge a saved config onto current defaults. Supplier/compare fields from v1 (GodEl as main) are replaced. */
  function migrateCfg(saved) {
    const base = saved && typeof saved === "object" ? saved : {};
    if ((base.version || 0) >= DEFAULTS.version) return Object.assign({}, DEFAULTS, base);
    const next = Object.assign({}, DEFAULTS);
    for (const k of KEEP_ON_MIGRATE) {
      if (base[k] != null) next[k] = base[k];
    }
    return next;
  }

  // Share of annual use per month for a heat-pump villa in south/central Sweden (sums to 1).
  const MONTH_WEIGHTS = [0.130, 0.115, 0.105, 0.085, 0.060, 0.045, 0.040, 0.045, 0.060, 0.085, 0.105, 0.125];

  // Relative use per local hour (typical Swedish villa, heat pump, weekday).
  const HOUR_WEIGHTS = [0.80, 0.75, 0.72, 0.72, 0.75, 0.90, 1.15, 1.30, 1.20, 1.05, 1.00, 1.00,
                        1.00, 0.98, 0.97, 1.00, 1.10, 1.30, 1.35, 1.30, 1.20, 1.10, 1.00, 0.90];

  // ---------- dates (all local Stockholm, taken from the API's ISO strings) ----------
  function parts(iso) { // "2026-11-09T13:15:00+01:00"
    return {
      y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10),
      h: +iso.slice(11, 13), min: +iso.slice(14, 16),
    };
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function weekday(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); } // 0 = Sun
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(dateStr, n) {
    const t = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10) + n));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function easter(y) { // anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }
  const holidayCache = {};
  // Days Skövde Energi counts as låglast even on weekdays (only Nov–Mar matters).
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const e = easter(y);
    const s = new Set([
      ymd(y, 1, 1), ymd(y, 1, 6), addDays(e, -3), addDays(e, -2), addDays(e, 1), ymd(y, 5, 1),
      addDays(e, 39), ymd(y, 6, 6), ymd(y, 12, 24), ymd(y, 12, 25), ymd(y, 12, 26), ymd(y, 12, 31),
    ]);
    holidayCache[y] = s;
    return s;
  }
  function isHighSeason(m) { return m >= 11 || m <= 3; }
  function isHighLoad(p) {
    if (!isHighSeason(p.m)) return false;
    const wd = weekday(p.y, p.m, p.d);
    if (wd === 0 || wd === 6) return false;
    if (p.h < 6 || p.h >= 22) return false;
    return !holidays(p.y).has(ymd(p.y, p.m, p.d));
  }

  // ---------- prices ----------
  const vatF = (cfg) => 1 + cfg.vat / 100;

  /** Normalise the API array into 15-minute points (expands hourly data if ever returned). */
  function normalize(raw) {
    const out = [];
    for (const r of raw || []) {
      const start = Date.parse(r.time_start), end = Date.parse(r.time_end);
      const spot = Number(r.SEK_per_kWh);
      if (!isFinite(start) || !isFinite(end) || !isFinite(spot)) continue;
      const n = Math.max(1, Math.round((end - start) / 900000));
      for (let i = 0; i < n; i++) {
        const t0 = start + i * 900000;
        // local ISO keeps the API's offset; only minutes change within an hour
        const iso = i === 0 ? r.time_start : r.time_start.slice(0, 14) + pad(+r.time_start.slice(14, 16) + i * 15) + r.time_start.slice(16);
        out.push({ iso, start: t0, end: t0 + 900000, spotEx: spot * 100 });
      }
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  function gridEx(p, cfg) { return isHighLoad(p) ? cfg.gridHighEx : cfg.gridLowEx; }

  /** Per-kWh breakdown in öre, INCLUDING moms. */
  function breakdown(pt, cfg) {
    const v = vatF(cfg), p = parts(pt.iso), high = isHighLoad(p);
    const spot = pt.spotEx * v;
    const grid = (high ? cfg.gridHighEx : cfg.gridLowEx) * v;
    const tax = cfg.energyTaxEx * v;
    const other = cfg.supplierOtherInc + cfg.supplierMarkupInc;
    return { spot, grid, tax, other, high, total: spot + grid + tax + other };
  }
  function priceOf(pt, cfg, mode) {
    return mode === "spot" ? pt.spotEx * vatF(cfg) : breakdown(pt, cfg).total;
  }

  function stats(points, cfg, mode) {
    if (!points.length) return null;
    let min = points[0], max = points[0], sum = 0;
    for (const pt of points) {
      const v = priceOf(pt, cfg, mode);
      sum += v;
      if (v < priceOf(min, cfg, mode)) min = pt;
      if (v > priceOf(max, cfg, mode)) max = pt;
    }
    return { min, max, minV: priceOf(min, cfg, mode), maxV: priceOf(max, cfg, mode), avg: sum / points.length };
  }

  /** Aggregate quarters to hours (simple mean). */
  function hourly(points) {
    const map = new Map();
    for (const pt of points) {
      const key = pt.iso.slice(0, 13);
      if (!map.has(key)) map.set(key, { iso: pt.iso.slice(0, 14) + "00" + pt.iso.slice(16), start: pt.start, end: pt.end, spotEx: 0, n: 0 });
      const h = map.get(key);
      h.spotEx += pt.spotEx; h.n++; h.end = pt.end;
    }
    return [...map.values()].map((h) => ({ iso: h.iso, start: h.start, end: h.end, spotEx: h.spotEx / h.n }));
  }

  /**
   * Cheapest continuous window of `minutes` among `points` (must be contiguous quarters),
   * starting no earlier than the quarter that contains `nowMs`. Energy `kwh` assumed spread evenly.
   */
  function cheapestWindow(points, minutes, kwh, nowMs, cfg, mode) {
    const n = Math.max(1, Math.round(minutes / 15));
    let first = points.findIndex((p) => p.end > nowMs);
    if (first < 0) return null;
    const vals = points.map((p) => priceOf(p, cfg, mode));
    let best = null, nowWin = null;
    for (let i = first; i + n <= points.length; i++) {
      if (points[i + n - 1].start - points[i].start !== (n - 1) * 900000) continue; // gap in data
      let s = 0;
      for (let j = i; j < i + n; j++) s += vals[j];
      const avg = s / n;
      const w = { startIdx: i, start: points[i], end: points[i + n - 1], avg, costKr: (avg * kwh) / 100 };
      if (i === first) nowWin = w;
      if (!best || avg < best.avg - 1e-9) best = w;
    }
    if (!best) return null;
    return { best, now: nowWin, quarters: n, savingKr: nowWin ? nowWin.costKr - best.costKr : 0 };
  }

  // ---------- monthly estimate ----------
  function syntheticDay(dateStr) { // 96 quarters for a day without prices (DST ignored)
    const out = [];
    for (let q = 0; q < 96; q++) {
      out.push({ iso: `${dateStr}T${pad(Math.floor(q / 4))}:${pad((q % 4) * 15)}:00`, spotEx: null });
    }
    return out;
  }

  /**
   * @param {Object<string, Array>} days  map "YYYY-MM-DD" -> normalized points (may be missing)
   * @param {number} y, m                 month to estimate
   * @param {object} cfg
   * @param {object} opts { actualKwh?: number, nowMs: number }
   */
  function monthEstimate(days, y, m, cfg, opts) {
    const v = vatF(cfg), nDays = daysInMonth(y, m);
    const estKwh = cfg.annualKwh * MONTH_WEIGHTS[m - 1];
    const monthKwh = opts.actualKwh > 0 ? opts.actualKwh : estKwh;
    const dayKwh = monthKwh / nDays;
    const nowMs = opts.nowMs;

    // pass 1: profile-weighted spot over known days
    let wSpot = 0, wKwh = 0, plainSum = 0, plainN = 0, knownDays = 0;
    const perDay = [];
    for (let d = 1; d <= nDays; d++) {
      const key = ymd(y, m, d);
      const pts = days[key] && days[key].length ? days[key] : null;
      if (pts) knownDays++;
      const list = pts || syntheticDay(key);
      let wsum = 0;
      for (const pt of list) wsum += HOUR_WEIGHTS[parts(pt.iso).h];
      perDay.push({ key, pts: list, known: !!pts, wsum });
      if (pts) for (const pt of list) {
        const k = (dayKwh * HOUR_WEIGHTS[parts(pt.iso).h]) / wsum;
        wSpot += k * pt.spotEx; wKwh += k; plainSum += pt.spotEx; plainN++;
      }
    }
    const profileSpotEx = wKwh ? wSpot / wKwh : null;   // öre/kWh exkl. moms
    const plainSpotEx = plainN ? plainSum / plainN : null;
    if (profileSpotEx == null) return null;

    // pass 2: costs (öre exkl. moms)
    let spot = 0, grid = 0, kwhHigh = 0, soFarKwh = 0, soFarVar = 0, totalQ = 0, elapsedQ = 0;
    const varPerKwhEx = cfg.energyTaxEx + (cfg.supplierOtherInc + cfg.supplierMarkupInc) / v;
    for (const day of perDay) {
      for (const pt of day.pts) {
        const p = parts(pt.iso);
        const k = (dayKwh * HOUR_WEIGHTS[p.h]) / day.wsum;
        const s = pt.spotEx == null ? profileSpotEx : pt.spotEx;
        const high = isHighLoad(p);
        const g = high ? cfg.gridHighEx : cfg.gridLowEx;
        spot += k * s; grid += k * g; if (high) kwhHigh += k;
        totalQ++;
        if (pt.start != null && pt.end <= nowMs) { elapsedQ++; soFarKwh += k; soFarVar += k * (s + g + varPerKwhEx); }
      }
    }
    const kr = (oreEx) => (oreEx * v) / 100;
    const effektKw = isHighSeason(m) && cfg.peakKw > 1 ? cfg.peakKw : 0;
    const lines = {
      spot: kr(spot),
      other: (monthKwh * (cfg.supplierOtherInc + cfg.supplierMarkupInc)) / 100,
      supplierFee: cfg.supplierFeeInc,
      gridFixed: (cfg.gridFixedYearEx / 12) * v,
      gridVar: kr(grid),
      effekt: effektKw * cfg.effektFeeEx * v,
      tax: kr(monthKwh * cfg.energyTaxEx),
    };
    const total = Object.values(lines).reduce((a, b) => a + b, 0);
    const comparePerKwh = (cfg.compareMarkupInc || 0) + (cfg.compareOtherInc || 0);
    const compare = total - lines.other - lines.supplierFee + (monthKwh * comparePerKwh) / 100 + cfg.compareFeeInc;
    const fixed = lines.supplierFee + lines.gridFixed + lines.effekt;
    const elapsed = totalQ ? elapsedQ / totalQ : 0;
    return {
      y, m, nDays, knownDays, monthKwh, estKwh, usedActual: opts.actualKwh > 0,
      profileSpotInc: profileSpotEx * v, plainSpotInc: plainSpotEx * v,
      kwhHigh, lines, total, perKwh: (total / monthKwh) * 100,
      compare, saving: compare - total,
      soFar: { kwh: soFarKwh, kr: (soFarVar * v) / 100 + fixed * elapsed, fraction: elapsed },
    };
  }

  const api = {
    GRID_TARIFFS, DEFAULTS, MONTH_WEIGHTS, HOUR_WEIGHTS, migrateCfg,
    parts, ymd, addDays, daysInMonth, easter, holidays, isHighLoad, isHighSeason,
    normalize, breakdown, priceOf, stats, hourly, cheapestWindow, monthEstimate, gridEx,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Tariff = api;
})(typeof self !== "undefined" ? self : this);
