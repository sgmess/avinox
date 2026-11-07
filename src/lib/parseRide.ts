/*
 * Reads an Avinox `cloud_ride_rec_*.proto` ride file, the raw recording the
 * Avinox Ride app keeps for each ride.
 *
 * Layout: a 251-byte header (magic 0xA5A5A5A5) then frames of type 0x02EB,
 * each holding one protobuf-encoded sample. DJI publishes no spec: the field
 * numbers come from the community's reverse engineering (Avinox Ride
 * Explorer, and lucad87/avinox-setup-app, MIT licence, Copyright (c) 2026
 * Luca Donnaloia, whose parser this follows).
 *
 * Each frame is `EB 02`, a uint16 LE payload length, the protobuf payload and
 * a uint16 LE CRC-16 of the payload (init 0x3692, reflected poly 0x8408), as
 * worked out in sgmess/avinox-stats. Frames that fail the CRC are skipped and
 * counted, and the reader resyncs on the next good frame.
 *
 * Runs in the browser (and under Node for the tests). Nothing is uploaded here.
 */

const HEADER_SIZE = 251;
const MAGIC = 0xa5a5a5a5;
const FRAME_TYPE = 0x02eb;

export type Sample = {
  /** Unix seconds. */
  t: number;
  /** km/h */
  speed: number;
  /** The assist value the bike recorded: a number, not a mode name. */
  assist: number | null;
  cadence: number;
  /** Nm */
  motorTorque: number;
  riderTorque: number;
  /** W */
  riderPower: number;
  motorPower: number;
  gear: number | null;
  /** Distance since the ride started, km. */
  km: number;
  lat: number | null;
  lng: number | null;
  /** Metres */
  altitude: number | null;
  /** °C */
  temperature: number | null;
  heartRate: number | null;
  /** % */
  battery: number | null;
  odometerKm: number | null;
  /** Rider work since the start, joules (field 52), if recorded. */
  energyJ: number | null;
};

export type RideFile = {
  rideId: number;
  serial: string;
  /** Unix seconds. */
  start: number;
  end: number;
  ascentM: number;
  descentM: number;
  samples: Sample[];
  /** Frames dropped for a bad checksum or an unreadable payload. */
  badFrames: number;
  /**
   * False when no frame passed the checksum and the file was read without it
   * (likely firmware that checks differently, possibly a damaged file).
   * badFrames then keeps the checksum failures as well.
   */
  checksumsVerified: boolean;
};

type Fields = Record<number, bigint | Uint8Array>;

function varint(bytes: Uint8Array, pos: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let b: number;
  do {
    if (pos >= bytes.length) throw new Error("Invalid varint");
    b = bytes[pos++];
    value |= BigInt(b & 127) << shift;
    shift += 7n;
  } while (b & 128);
  return [value, pos];
}

/** One protobuf message as {field number: last value}. */
function message(bytes: Uint8Array): Fields {
  const out: Fields = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p < bytes.length) {
    const [tag, next] = varint(bytes, p);
    p = next;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const [v, q] = varint(bytes, p);
      out[field] = v;
      p = q;
    } else if (wire === 1) {
      out[field] = view.getBigUint64(p, true);
      p += 8;
    } else if (wire === 5) {
      out[field] = BigInt(view.getUint32(p, true));
      p += 4;
    } else if (wire === 2) {
      const [n, q] = varint(bytes, p);
      p = q;
      out[field] = bytes.slice(p, p + Number(n));
      p += Number(n);
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return out;
}

const big = (v: bigint | Uint8Array | undefined) => (typeof v === "bigint" ? v : null);
const num = (v: bigint | Uint8Array | undefined) => {
  const b = big(v);
  return b === null ? null : Number(b);
};
const signed = (v: bigint | Uint8Array | undefined) => {
  const b = big(v);
  if (b === null) return null;
  return b >= 1n << 63n ? Number(b - (1n << 64n)) : Number(b);
};
const scaled = (v: bigint | Uint8Array | undefined, d: number) => {
  const n = num(v);
  return n === null ? 0 : n / d;
};
/** GPS doubles arrive as the raw 64-bit pattern. */
function f64(v: bigint | Uint8Array | undefined) {
  const b = big(v);
  if (b === null) return null;
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt.asUintN(64, b), true);
  const x = view.getFloat64(0, true);
  return Number.isFinite(x) && x !== 0 ? x : null;
}

function sample(f: Fields): Sample {
  const temp = signed(f[41]);
  const alt = signed(f[39]);
  const lat = f64(f[31]);
  const lng = f64(f[32]);
  const valid = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    t: num(f[72]) ?? 0,
    speed: scaled(f[7], 100),
    assist: num(f[8]),
    cadence: scaled(f[9], 100),
    motorTorque: scaled(f[10], 100),
    riderTorque: scaled(f[11], 100),
    riderPower: scaled(f[13], 100),
    motorPower: scaled(f[14], 100),
    gear: num(f[22]),
    km: scaled(f[23], 1000),
    lat: valid ? lat : null,
    lng: valid ? lng : null,
    altitude: alt === null ? null : alt / 100,
    temperature: temp === null || temp === -99900 ? null : temp / 100,
    heartRate: num(f[51]) || null,
    battery: num(f[71]),
    odometerKm: f[73] === undefined ? null : scaled(f[73], 1000),
    energyJ: num(f[52]),
  };
}

/** CRC-16 of a frame's payload, as the bike writes it. */
export function crc16(bytes: Uint8Array, start = 0, end = bytes.length) {
  let crc = 0x3692;
  for (let p = start; p < end; p++) {
    crc ^= bytes[p];
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc;
}

export function isRideFile(buffer: ArrayBuffer) {
  return buffer.byteLength >= HEADER_SIZE && new DataView(buffer).getUint32(0, true) === MAGIC;
}

/**
 * Walks the frames to the end of the file: the header's sample count is
 * sometimes one short. A frame with a bad checksum is dropped, and the reader
 * steps forward a byte at a time until the next frame checks out.
 */
function readFrames(bytes: Uint8Array, view: DataView, checkCrc: boolean) {
  const samples: Sample[] = [];
  let badFrames = 0;
  let lost = false;
  let p = HEADER_SIZE;
  while (p + 6 <= bytes.length) {
    const type = view.getUint16(p, true);
    const end = p + 4 + view.getUint16(p + 2, true);
    const fits = end + 2 <= bytes.length;
    if (type !== FRAME_TYPE || !fits || (checkCrc && crc16(bytes, p + 4, end) !== view.getUint16(end, true))) {
      // A ride cut off mid-write keeps what it has.
      if (!lost && type === FRAME_TYPE && fits) badFrames++;
      if (!checkCrc && type === FRAME_TYPE && !fits) break;
      lost = true;
      p++;
      continue;
    }
    lost = false;
    try {
      samples.push(sample(message(bytes.subarray(p + 4, end))));
    } catch {
      badFrames++;
    }
    p = end + 2;
  }
  return { samples, badFrames };
}

export function parseRide(buffer: ArrayBuffer): RideFile {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (!isRideFile(buffer)) throw new Error("This isn't an Avinox ride file.");

  let serial = "";
  for (let i = 110; i < 128 && bytes[i]; i++) serial += String.fromCharCode(bytes[i]);

  let { samples, badFrames } = readFrames(bytes, view, true);
  let checksumsVerified = true;
  // The checksum is known from one firmware's files. If none pass, this file's
  // firmware likely checks them differently: read it the way the bike lays it
  // out, but keep the failures and flag the ride so the warning isn't lost.
  if (!samples.length && badFrames) {
    const unchecked = readFrames(bytes, view, false);
    samples = unchecked.samples;
    badFrames += unchecked.badFrames;
    checksumsVerified = false;
  }

  return {
    rideId: view.getUint32(6, true),
    serial,
    start: view.getUint32(10, true),
    end: view.getUint32(14, true),
    ascentM: view.getFloat32(22, true),
    descentM: view.getFloat32(26, true),
    samples: samples.filter((s) => s.t > 0),
    badFrames,
    checksumsVerified,
  };
}
