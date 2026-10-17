// River courses: a smooth centreline through control points, densely sampled
// with the distance along it, so any position can be turned into "how far
// along" and "how far off the middle". Pure, no DOM.

const SPACING = 2; // metres between samples

// points: [[x, z], ...] in paddling order. start/finish are distances along the river.
// warp: race distances and times are shown this many times longer than they
// really are, so a 6 km marathon fits in a few minutes of play (see README).
export function createCourse(points, { width = 34, start = 60, finish = 1060, warp = 1 } = {}) {
  const raw = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / (SPACING / 4));
    for (let k = 0; k < n; k++) raw.push(catmullRom(p0, p1, p2, p3, k / n));
  }
  raw.push(points.at(-1));

  // Resample to even spacing so distances and lookups are simple.
  const samples = [{ x: raw[0][0], z: raw[0][1], s: 0 }];
  let carried = 0;
  for (let i = 1; i < raw.length; i++) {
    const [ax, az] = raw[i - 1];
    const [bx, bz] = raw[i];
    const len = Math.hypot(bx - ax, bz - az);
    let t = SPACING - carried;
    while (t <= len) {
      const f = t / len;
      samples.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, s: samples.length * SPACING });
      t += SPACING;
    }
    carried = len - (t - SPACING);
  }
  samples.forEach((p, i) => {
    const a = samples[Math.max(i - 1, 0)];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    p.tx = (b.x - a.x) / len;
    p.tz = (b.z - a.z) / len;
  });

  return { samples, width, start, finish, warp, length: (samples.length - 1) * SPACING };
}

// Nearest point on the centreline. `hint` (a previous result's index) limits the
// search to nearby samples, which is all a moving boat needs.
export function locate(course, x, z, hint = -1) {
  const { samples } = course;
  const from = hint < 0 ? 0 : Math.max(0, hint - 25);
  const to = hint < 0 ? samples.length - 1 : Math.min(samples.length - 1, hint + 25);
  let best = null;
  for (let i = from; i < to; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const cx = a.x + dx * f;
    const cz = a.z + dz * f;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (!best || d2 < best.d2) best = { i, f, cx, cz, d2 };
  }
  const a = samples[best.i];
  const tx = a.tx;
  const tz = a.tz;
  // Right of the direction of travel is (-tz, tx).
  const lateral = (x - best.cx) * -tz + (z - best.cz) * tx;
  return { i: best.i, s: a.s + best.f * SPACING, lateral, tx, tz, x: best.cx, z: best.cz };
}

// Position and direction at a distance along the course.
export function pointAt(course, s) {
  const { samples } = course;
  const i = Math.max(0, Math.min(samples.length - 2, Math.floor(s / SPACING)));
  const f = Math.max(0, Math.min(1, s / SPACING - i));
  const a = samples[i];
  const b = samples[i + 1];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, tx: a.tx, tz: a.tz };
}

export function headingAt(course, s) {
  const p = pointAt(course, s);
  return Math.atan2(p.tx, -p.tz);
}

// The practice river: a 1 km time trial through gentle S-bends.
export function practiceRiver() {
  const points = [];
  for (let i = 0; i <= 14; i++) {
    points.push([Math.sin(i * 1.1) * 50 + Math.sin(i * 0.37) * 25, -i * 100]);
  }
  return createCourse(points, { width: 34, start: 60, finish: 1060 });
}

// A division race: `km` on the HUD, through wider, longer bends for a pack.
export function raceRiver(km = 6, warp = 4) {
  const start = 80;
  const finish = start + (km * 1000) / warp;
  const points = [];
  for (let i = 0; i * 100 <= finish + 160; i++) {
    points.push([Math.sin(i * 0.7) * 70 + Math.sin(i * 0.29 + 1) * 45, -i * 100]);
  }
  return createCourse(points, { width: 48, start, finish, warp });
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (
    2 * p1[k]
    + (-p0[k] + p2[k]) * t
    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
  ));
}
