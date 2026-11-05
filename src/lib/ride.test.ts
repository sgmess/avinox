import { test } from "node:test";
import assert from "node:assert/strict";
import { crc16, parseRide } from "./parseRide.ts";
import { summarise } from "./ride.ts";
import { batteryDrop, computeStats, modeParts, packWh } from "./stats.ts";
import { demoRides } from "./demo.ts";
import { DEFAULT_SETTINGS, cleanSettings, modeName } from "./settings.ts";

// Builds a ride file the way the bike writes one: header, then 0x02EB frames.
function varint(n: number | bigint) {
  let v = BigInt.asUintN(64, BigInt(typeof n === "number" ? Math.round(n) : n));
  const out: number[] = [];
  do {
    let b = Number(v & 127n);
    v >>= 7n;
    if (v) b |= 128;
    out.push(b);
  } while (v);
  return out;
}
const key = (field: number, wire: number) => varint((field << 3) | wire);
const vf = (field: number, n: number) => [...key(field, 0), ...varint(n)];
const df = (field: number, x: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(x);
  return [...key(field, 1), ...b];
};

function buildFile(samples: { t: number; speed: number; assist: number; motorPower: number; km: number; battery: number; temp: number; alt: number; gear: number; torque: number }[]) {
  const header = Buffer.alloc(251);
  header.writeUInt32LE(0xa5a5a5a5, 0);
  header.writeUInt32LE(7, 6);
  header.writeUInt32LE(samples[0].t, 10);
  header.writeUInt32LE(samples[samples.length - 1].t, 14);
  header.writeFloatLE(42, 22);
  header.writeFloatLE(40, 26);
  header.write("SN123", 110, "latin1");
  const frames = samples.map((s) => {
    const msg = Buffer.from([
      ...vf(72, s.t),
      ...vf(7, s.speed * 100),
      ...vf(8, s.assist),
      ...vf(9, 7000),
      ...vf(10, s.torque * 100),
      ...vf(13, 15000),
      ...vf(14, s.motorPower * 100),
      ...vf(22, s.gear),
      ...vf(23, s.km * 1000),
      ...df(31, 52.7),
      ...df(32, -2.0),
      ...vf(39, s.alt * 100),
      ...vf(41, s.temp * 100),
      ...vf(71, s.battery),
    ]);
    const head = Buffer.alloc(4);
    head.writeUInt16LE(0x02eb, 0);
    head.writeUInt16LE(msg.length, 2);
    const crc = Buffer.alloc(2);
    crc.writeUInt16LE(crc16(msg), 0);
    return Buffer.concat([head, msg, crc]);
  });
  const buf = Buffer.concat([header, ...frames]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const t0 = 1_760_000_000;
const rows = Array.from({ length: 600 }, (_, i) => ({
  t: t0 + i,
  speed: 20,
  assist: i < 300 ? 2 : 3,
  motorPower: i < 300 ? 200 : 400,
  km: (i * 20) / 3600,
  battery: 100 - Math.floor(i / 30),
  temp: 12 + i / 100,
  alt: 100 + i / 10,
  gear: i < 300 ? 5 : 9,
  torque: i < 300 ? 30 : 65,
}));

test("reads a ride file", () => {
  const ride = parseRide(buildFile(rows));
  assert.equal(ride.serial, "SN123");
  assert.equal(ride.rideId, 7);
  assert.equal(ride.samples.length, 600);
  const s = ride.samples[10];
  assert.equal(s.speed, 20);
  assert.equal(s.assist, 2);
  assert.equal(s.cadence, 70);
  assert.equal(s.riderPower, 150);
  assert.equal(s.lat, 52.7);
  assert.equal(s.lng, -2.0);
  assert.equal(s.temperature, 12.1);
  assert.equal(s.battery, 100);
});

test("rejects other files", () => {
  assert.throws(() => parseRide(new ArrayBuffer(400)), /isn't an Avinox ride file/);
});

test("summarises a ride", () => {
  const { summary, track } = summarise(parseRide(buildFile(rows)));
  assert.equal(summary.id, "SN123-7-1760000000");
  assert.equal(summary.ascentM, 42);
  assert.equal(summary.batteryStart, 100);
  assert.equal(summary.batteryEnd, 81);
  assert.ok(Math.abs(summary.km - 3.328) < 0.01);
  // Each sample holds until the next; the last one adds no time.
  assert.equal(summary.modeS["2"], 300);
  assert.equal(summary.modeS["3"], 299);
  assert.ok(Math.abs(summary.motorWh - (300 * 200 + 299 * 400) / 3600) < 0.2);
  assert.equal(summary.gearS["9"], 299);
  assert.equal(summary.torqueS[3], 300);
  assert.equal(summary.torqueS[6], 299);
  assert.equal(summary.observedS, 599);
  assert.equal(summary.unknownS, 0);
  assert.deepEqual(summary.torqueZoneS, [0, 300, 299, 0, 0]);
  assert.deepEqual(summary.wattZoneS, [0, 300, 299, 0, 0]);
  assert.equal(summary.gearChanges, 1);
  assert.equal(summary.gearPedalS?.["5"], 300);
  assert.equal(summary.riderWAvg, 150);
  assert.equal(summary.motorWMax, 400);
  assert.equal(summary.cadenceAvg, 70);
  // 0.1 m a second at 20 km/h: a 1.8% climb.
  assert.ok(Math.abs(summary.gradeUpPct! - 1.8) < 0.1, `grade ${summary.gradeUpPct}`);
  assert.equal(summary.tempMin, 12);
  assert.ok(track.length <= 600 && track.length > 100);
});

test("dashboard stats from a year and a half of rides", () => {
  const { summaries } = demoRides();
  const st = computeStats(summaries, DEFAULT_SETTINGS, Date.UTC(2026, 9, 10) / 1000);
  assert.ok(st.totals.rides > 80, `rides ${st.totals.rides}`);
  assert.ok(st.months.length >= 17);
  assert.ok(st.efficiency > 0.75 && st.efficiency < 0.85, `efficiency ${st.efficiency}`);
  assert.ok(st.health && st.health.pct < 100 && st.health.pct > 85, `health ${st.health?.pct}`);
  const names = st.modes.map((m) => m.name);
  assert.deepEqual(names, ["Eco", "Auto", "Trail", "Turbo"]);
  const eco = st.range.find((r) => r.name === "Eco")!;
  const turbo = st.range.find((r) => r.name === "Turbo")!;
  assert.ok(eco.km > turbo.km);
  assert.ok(st.gears.length === 12);
  assert.ok(st.records.longest);
});

test("a ride ending at zero battery keeps its full battery consumption", () => {
  const drained = rows.map((row, i) => ({ ...row, battery: i === rows.length - 1 ? 0 : 20 }));
  const { summary } = summarise(parseRide(buildFile(drained)));
  assert.equal(summary.batteryStart, 20);
  assert.equal(summary.batteryEnd, 0);
  assert.equal(batteryDrop(summary), 20);
  assert.equal(packWh(summary, DEFAULT_SETTINGS, 0.8), DEFAULT_SETTINGS.batteryWh * 0.2);
});

test("settings are cleaned", () => {
  const s = cleanSettings({ units: "km", batteryWh: "600", modeNames: { "20": " Hills ", bad: "x" }, bikeName: 5 });
  assert.deepEqual(s, { units: "km", batteryWh: 600, bikeName: "", modeNames: { "20": "Hills" } });
  assert.equal(modeName(s, 20), "Hills");
  assert.equal(modeName(s, 21), "Custom 2");
  assert.equal(modeName(s, 1), "Eco");
});

test("out-of-order samples are sorted and the last sample at a timestamp wins", () => {
  const file = parseRide(buildFile(rows.slice(0, 10)));
  const expected = summarise(file);
  const shuffled = { ...file, samples: [...file.samples].reverse() };
  assert.deepEqual(summarise(shuffled), expected);
  // A stale copy written before the real sample is replaced by it.
  const stale = { ...file.samples[1], motorPower: 5000, battery: 0 };
  const withStale = { ...file, samples: [file.samples[0], stale, ...file.samples.slice(1)] };
  assert.deepEqual({ ...summarise(withStale).summary, duplicates: 0 }, expected.summary);
  assert.equal(summarise(withStale).summary.duplicates, 1);
});

test("gaps longer than one missed reading are unknown time", () => {
  // 1 Hz, then 30 s with nothing, then 1 Hz again.
  const gappy = rows.slice(0, 120).map((row, i) => ({ ...row, t: t0 + i + (i >= 60 ? 30 : 0) }));
  const { summary } = summarise(parseRide(buildFile(gappy)));
  assert.equal(summary.unknownS, 31);
  assert.equal(summary.observedS, 118);
  assert.equal(summary.movingS, 118);
  // A 2 s step (one missed reading) still counts.
  const missed = rows.slice(0, 10).map((row, i) => ({ ...row, t: t0 + i + (i >= 5 ? 1 : 0) }));
  assert.equal(summarise(parseRide(buildFile(missed))).summary.observedS, 10);
});

test("a frame with a bad checksum is dropped and the rest still read", () => {
  const buf = new Uint8Array(buildFile(rows.slice(0, 20)));
  // Flip a byte inside the third frame's payload.
  let p = 251;
  for (let i = 0; i < 2; i++) p += 6 + (buf[p + 2] | (buf[p + 3] << 8));
  buf[p + 10] ^= 0xff;
  const ride = parseRide(buf.buffer);
  assert.equal(ride.badFrames, 1);
  assert.equal(ride.samples.length, 19);
  // Junk between frames is skipped without counting a frame.
  const junk = new Uint8Array(buf.length + 3);
  const good = new Uint8Array(buildFile(rows.slice(0, 20)));
  junk.set(good.subarray(0, 251 + 50));
  junk.set(good.subarray(251 + 50), 251 + 53);
  const resynced = parseRide(junk.buffer);
  assert.ok(resynced.samples.length >= 18, `samples ${resynced.samples.length}`);
});

test("thinned tracks retain both endpoints and stay within 600 points", () => {
  for (const length of [1, 2, 599, 600, 601, 602, 1200, 1801]) {
    const input = Array.from({ length }, (_, i) => ({ ...rows[0], t: t0 + i, km: 10 + i / 100 }));
    const file = parseRide(buildFile(input));
    const { summary, track } = summarise(file);
    assert.ok(track.length <= 600);
    assert.equal(track[0].s, 0);
    assert.equal(track[0].km, 0);
    assert.equal(track.at(-1)!.s, length - 1);
    assert.equal(track.at(-1)!.km, summary.km);
    assert.equal(track.at(-1)!.lat, file.samples.at(-1)!.lat);
    assert.equal(track.at(-1)!.lng, file.samples.at(-1)!.lng);
  }
});

test("renaming modes does not change assisted time, shares or range eligibility", () => {
  const { summary } = summarise(parseRide(buildFile(rows)));
  const ride = { ...summary, modeS: { "0": 600, "1": 600 }, modeKm: { "0": 5, "1": 5 }, modeMotorWh: { "0": 0, "1": 50 } };
  const renamed = { ...DEFAULT_SETTINGS, modeNames: { "0": "Coasting", "1": "Off" } };
  const before = computeStats([ride], DEFAULT_SETTINGS);
  const after = computeStats([ride], renamed);
  assert.equal(after.totals.assistedS, 600);
  assert.equal(after.totals.assistedS, before.totals.assistedS);
  assert.deepEqual(modeParts(ride, renamed).map(({ key, share }) => ({ key, share })), [{ key: "1", share: 1 }]);
  assert.deepEqual(after.range.map(({ value, km }) => ({ value, km })), before.range.map(({ value, km }) => ({ value, km })));
});

test("a file where no checksum matches is still read", () => {
  const buf = new Uint8Array(buildFile(rows.slice(0, 20)));
  let p = 251;
  while (p < buf.length) {
    const len = buf[p + 2] | (buf[p + 3] << 8);
    buf[p + 4 + len] ^= 0x55;
    p += 6 + len;
  }
  assert.equal(parseRide(buf.buffer).samples.length, 20);
});
