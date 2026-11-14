// node test/tariff.test.js  — unit checks for tariff.js (uses live API data when reachable)
const assert = require("assert");
const T = require("../tariff.js");
const cfg = Object.assign({}, T.DEFAULTS);

// high-load rules
assert.strictEqual(T.isHighLoad(T.parts("2026-11-09T07:00:00+01:00")), true, "Mon 07 Nov = peak");
assert.strictEqual(T.isHighLoad(T.parts("2026-11-09T22:00:00+01:00")), false, "22:00 = off-peak");
assert.strictEqual(T.isHighLoad(T.parts("2026-11-08T12:00:00+01:00")), false, "Sunday = off-peak");
assert.strictEqual(T.isHighLoad(T.parts("2026-12-24T12:00:00+01:00")), false, "Julafton = off-peak");
assert.strictEqual(T.isHighLoad(T.parts("2026-06-10T12:00:00+02:00")), false, "June = off-peak");
assert.strictEqual(T.easter(2026), "2026-04-05");

// breakdown: 100 öre spot ex moms, peak → (100 + 22 + 36)*1.25 + 2.24 (Telinet påslag)
const b = T.breakdown({ iso: "2026-11-09T07:00:00+01:00", spotEx: 100 }, cfg);
assert.ok(Math.abs(b.total - ((100 + 22 + 36) * 1.25 + 2.24)) < 1e-9, "breakdown total");

// hourly data gets expanded to quarters
const exp = T.normalize([{ SEK_per_kWh: 1, time_start: "2026-11-09T01:00:00+01:00", time_end: "2026-11-09T02:00:00+01:00" }]);
assert.strictEqual(exp.length, 4); assert.strictEqual(exp[3].iso.slice(11, 16), "01:45");

// cheapest window on synthetic data: cheap block 03:00–05:00
const raw = [];
for (let q = 0; q < 96; q++) {
  const h = Math.floor(q / 4), m = (q % 4) * 15, iso = `2026-11-09T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+01:00`;
  const end = new Date(Date.parse(iso) + 900000).toISOString();
  raw.push({ SEK_per_kWh: h >= 3 && h < 5 ? 0.2 : 1.5, time_start: iso, time_end: end });
}
const pts = T.normalize(raw);
const w = T.cheapestWindow(pts, 120, 1, Date.parse("2026-11-09T00:10:00+01:00"), cfg, "spot");
assert.strictEqual(w.best.start.iso.slice(11, 16), "03:00", "cheapest 2h starts 03:00");
assert.ok(Math.abs(w.best.costKr - 0.25) < 1e-9, "2h @ 20 öre ex = 25 öre inc for 1 kWh");


assert.strictEqual(T.DEFAULTS.version, 2);
assert.strictEqual(T.DEFAULTS.supplierFeeInc, 0);
assert.strictEqual(T.DEFAULTS.supplierMarkupInc, 2.24);
assert.strictEqual(T.DEFAULTS.supplierOtherInc, 0);
assert.strictEqual(T.DEFAULTS.compareName, "GodEl");
assert.strictEqual(T.DEFAULTS.compareFeeInc, 49);
assert.strictEqual(T.DEFAULTS.compareOtherInc, 6.0);

const migrated = T.migrateCfg({
  version: 1,
  supplierFeeInc: 49,
  supplierMarkupInc: 0,
  supplierOtherInc: 6.0,
  compareName: "Telinet",
  compareFeeInc: 69,
  compareMarkupInc: 16.8,
  fuse: "25",
  peakKw: 5.5,
  annualKwh: 9000,
  gridFixedYearEx: 2425,
});
assert.strictEqual(migrated.version, 2);
assert.strictEqual(migrated.supplierFeeInc, 0);
assert.strictEqual(migrated.supplierMarkupInc, 2.24);
assert.strictEqual(migrated.supplierOtherInc, 0);
assert.strictEqual(migrated.compareName, "GodEl");
assert.strictEqual(migrated.compareFeeInc, 49);
assert.strictEqual(migrated.compareOtherInc, 6.0);
assert.strictEqual(migrated.compareMarkupInc, 0);
assert.strictEqual(migrated.fuse, "25");
assert.strictEqual(migrated.peakKw, 5.5);
assert.strictEqual(migrated.annualKwh, 9000);
assert.strictEqual(migrated.gridFixedYearEx, 2425);

const already = T.migrateCfg({ version: 2, supplierFeeInc: 10, peakKw: 3 });
assert.strictEqual(already.supplierFeeInc, 10, "v2 custom fee kept");
assert.strictEqual(already.peakKw, 3);

(async () => {
  const day = (d) => fetch(`https://www.elprisetjustnu.se/api/v1/prices/2026/11-${d}_SE3.json`).then((r) => (r.ok ? r.json() : null));
  const days = {};
  for (let d = 1; d <= 10; d++) {
    const k = `2026-11-${String(d).padStart(2, "0")}`;
    const r = await day(String(d).padStart(2, "0"));
    if (r) days[k] = T.normalize(r);
  }
  const today = days["2026-11-09"];
  assert.ok(today && (today.length === 96), "today has 96 quarters, got " + (today && today.length));
  const st = T.stats(today, cfg, "total");
  const est = T.monthEstimate(days, 2026, 11, cfg, { nowMs: Date.now() });
  const est2 = T.monthEstimate(days, 2026, 11, cfg, { nowMs: Date.now(), actualKwh: 1000 });
  const win = T.cheapestWindow([].concat(today, days["2026-11-10"] || []), 120, 1, Date.now(), cfg, "total");
  console.log(JSON.stringify({
    knownDays: Object.keys(days).length,
    todayAvgTotal: st.avg.toFixed(1), todayMin: st.minV.toFixed(1), todayMax: st.maxV.toFixed(1),
    todayAvgSpotInc: T.stats(today, cfg, "spot").avg.toFixed(1),
    cheapest2h: win && { start: win.best.start.iso, avg: win.best.avg.toFixed(1), cost: win.best.costKr.toFixed(2), now: win.now.costKr.toFixed(2) },
    month: { kwh: est.monthKwh, total: est.total.toFixed(0), compare: est.compare.toFixed(0), saving: est.saving.toFixed(0),
      lines: Object.fromEntries(Object.entries(est.lines).map(([k, v]) => [k, v.toFixed(0)])), soFar: est.soFar.kr.toFixed(0),
      profileSpot: est.profileSpotInc.toFixed(1), plainSpot: est.plainSpotInc.toFixed(1) },
    actual1000: est2.total.toFixed(0),
  }, null, 1));
  assert.ok(st.avg > 40 && st.avg < 1000, "sane avg");
  assert.ok(est.total > 800 && est.total < 6000, "sane month total");
  assert.ok(est.saving > 0, "Telinet cheaper than GodEl");
  console.log("all tariff tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
