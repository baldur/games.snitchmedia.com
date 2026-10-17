// Builds the static scenery for a course into one mesh: river banks, trees,
// distant hills, start and finish gantries and distance markers. Pure, no GPU.
import { MeshBuilder } from './meshes.js';
import { locate, pointAt } from './course.js';

const COLORS = {
  mud: [0.42, 0.36, 0.27],
  grass: [0.36, 0.52, 0.25],
  meadow: [0.45, 0.58, 0.3],
  trunk: [0.35, 0.25, 0.17],
  pine: [0.17, 0.36, 0.22],
  leaf: [0.3, 0.47, 0.2],
  hill: [0.38, 0.47, 0.42],
  post: [0.92, 0.92, 0.88],
  buoy: [0.98, 0.72, 0.1],
  start: [0.2, 0.7, 0.35],
  finishA: [0.95, 0.95, 0.95],
  finishB: [0.1, 0.1, 0.1],
  marker: [0.95, 0.35, 0.2],
};

// The bank rises from just under the water at the edge to rolling fields.
const PROFILE = [[0, -0.4], [2.5, 0.35], [7, 1.1], [30, 2.2], [160, 4]];

export function buildWorld(course, seed = 1) {
  const rand = mulberry32(seed);
  const m = new MeshBuilder();
  const half = course.width / 2;
  const { samples } = course;
  const stride = 3; // bank quads every 6 m

  for (const side of [-1, 1]) {
    for (let i = 0; i + stride < samples.length; i += stride) {
      const a = samples[i];
      const b = samples[i + stride];
      for (let k = 0; k < PROFILE.length - 1; k++) {
        const [d0, h0] = PROFILE[k];
        const [d1, h1] = PROFILE[k + 1];
        const p = (s, d, h) => [s.x + -s.tz * side * (half + d), h + bump(s.x, s.z, d), s.z + s.tx * side * (half + d)];
        const color = k === 0 ? COLORS.mud : shade(k === 1 ? COLORS.grass : COLORS.meadow, rand, 0.08);
        m.quad(p(a, d0, h0), p(b, d0, h0), p(b, d1, h1), p(a, d1, h1), color);
      }
    }
  }

  // Close the river off just before the start and after the end.
  for (const s of [0, course.length]) {
    const c = pointAt(course, s);
    const dir = s === 0 ? -1 : 1;
    const back = [c.x + c.tx * dir * 6, c.z + c.tz * dir * 6];
    const r = [-c.tz, c.tx];
    const w = half + 10;
    m.quad(
      [c.x - r[0] * w, 1, c.z - r[1] * w], [c.x + r[0] * w, 1, c.z + r[1] * w],
      [back[0] + r[0] * w, 1.4, back[1] + r[1] * w], [back[0] - r[0] * w, 1.4, back[1] - r[1] * w],
      COLORS.grass,
    );
  }

  // Trees along both banks, kept out of the water on the inside of bends.
  for (let s = 0; s < course.length; s += 5) {
    const c = pointAt(course, s);
    for (const side of [-1, 1]) {
      const count = rand() < 0.75 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const d = half + 8 + rand() ** 1.6 * 90;
        const x = c.x - c.tz * side * d + (rand() - 0.5) * 6;
        const z = c.z + c.tx * side * d + (rand() - 0.5) * 6;
        if (Math.abs(locate(course, x, z).lateral) < half + 6) continue;
        tree(m, x, groundHeight(d - half) + bump(x, z, d), z, rand);
      }
    }
  }

  // Hills on the horizon, kept well clear of every part of the river.
  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  const box = [Math.min(...xs) - 900, Math.min(...zs) - 900, Math.max(...xs) + 900, Math.max(...zs) + 900];
  for (let placed = 0, tries = 0; placed < 60 && tries < 2000; tries++) {
    const x = box[0] + rand() * (box[2] - box[0]);
    const z = box[1] + rand() * (box[3] - box[1]);
    const radius = 120 + rand() * 160;
    if (Math.abs(locate(course, x, z).lateral) < radius + 450) continue;
    m.cone([x, 0, z], radius, 50 + rand() * 90, 7, shade(COLORS.hill, rand, 0.1));
    placed++;
  }

  gantry(m, course, course.start, COLORS.start, COLORS.post);
  gantry(m, course, course.finish, COLORS.finishA, COLORS.finishB);

  // Buoys along both edges every 50 m, a marker post every 250 m.
  for (let s = course.start; s <= course.finish; s += 50) {
    const c = pointAt(course, s);
    for (const side of [-1, 1]) {
      const d = half - 2.5;
      m.sphere([c.x - c.tz * side * d, 0.05, c.z + c.tx * side * d], 0.35, COLORS.buoy);
    }
    if ((s - course.start) % 250 === 0 && s !== course.start && s !== course.finish) {
      const d = half + 3;
      const x = c.x - c.tz * d;
      const z = c.z + c.tx * d;
      m.cylinder([x, 0.3, z], 0.08, 2.6, 6, COLORS.post);
      m.box([x - 0.6, 2.4, z - 0.6], [x + 0.6, 3.4, z + 0.6], COLORS.marker);
    }
  }

  return m.build();
}

// Two posts on the banks and a banner across the river, chequered or striped.
function gantry(m, course, s, colorA, colorB) {
  const c = pointAt(course, s);
  const half = course.width / 2 + 1.5;
  const r = [-c.tz, c.tx];
  const left = [c.x - r[0] * half, c.z - r[1] * half];
  const right = [c.x + r[0] * half, c.z + r[1] * half];
  for (const [x, z] of [left, right]) m.cylinder([x, 0, z], 0.25, 6.5, 8, [0.85, 0.85, 0.82]);
  const cells = 24;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      const f0 = i / cells;
      const f1 = (i + 1) / cells;
      const x0 = left[0] + (right[0] - left[0]) * f0;
      const z0 = left[1] + (right[1] - left[1]) * f0;
      const x1 = left[0] + (right[0] - left[0]) * f1;
      const z1 = left[1] + (right[1] - left[1]) * f1;
      const y0 = 5 + j * 0.6;
      const y1 = y0 + 0.6;
      m.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], (i + j) % 2 ? colorA : colorB);
    }
  }
}

function tree(m, x, y, z, rand) {
  const pine = rand() < 0.55;
  const h = pine ? 7 + rand() * 9 : 5 + rand() * 6;
  m.cylinder([x, y - 0.3, z], 0.2 + h * 0.015, h * 0.35, 5, COLORS.trunk);
  if (pine) {
    for (let k = 0; k < 3; k++) {
      m.cone([x, y + h * (0.25 + k * 0.22), z], h * (0.32 - k * 0.07), h * 0.42, 7, shade(COLORS.pine, rand, 0.1));
    }
  } else {
    m.cone([x, y + h * 0.3, z], h * 0.38, h * 0.75, 7, shade(COLORS.leaf, rand, 0.12));
  }
}

function groundHeight(d) {
  for (let k = 0; k < PROFILE.length - 1; k++) {
    const [d0, h0] = PROFILE[k];
    const [d1, h1] = PROFILE[k + 1];
    if (d <= d1) return h0 + ((h1 - h0) * (d - d0)) / (d1 - d0);
  }
  return PROFILE.at(-1)[1];
}

// Gentle unevenness away from the water's edge, so fields aren't flat.
function bump(x, z, d) {
  const away = Math.min(1, Math.max(0, (d - 5) / 25));
  return away * (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.2 + Math.sin(x * 0.013 + z * 0.017) * 2);
}

function shade(color, rand, amount) {
  const k = 1 + (rand() - 0.5) * 2 * amount;
  return color.map((c) => Math.min(1, c * k));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
