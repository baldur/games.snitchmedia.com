// Procedural low-poly geometry: everything in the scene is built here from
// code, so there are no model files. Flat-shaded triangles with per-vertex
// colour; vertices are interleaved as position, normal, colour (9 floats).

export class MeshBuilder {
  data = [];
  count = 0;

  // One flat-shaded triangle. Winding doesn't matter: the renderer doesn't cull.
  tri(a, b, c, color) {
    const u = sub(b, a);
    const v = sub(c, a);
    let n = normalize(cross(u, v));
    if (n[1] < 0) n = n.map((x) => -x); // keep normals facing up-ish for lighting
    for (const p of [a, b, c]) this.data.push(...p, ...n, ...color);
    this.count += 3;
  }

  // Like tri() but keeps the true facing normal, for vertical surfaces like hull sides.
  triFacing(a, b, c, color, outward) {
    const n0 = normalize(cross(sub(b, a), sub(c, a)));
    const n = dot(n0, outward) < 0 ? n0.map((x) => -x) : n0;
    for (const p of [a, b, c]) this.data.push(...p, ...n, ...color);
    this.count += 3;
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  // Upright cone, e.g. a tree crown or a distant hill.
  cone([x, y, z], radius, height, segments, color, shade = 0.12) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius];
      const p1 = [x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius];
      const out = [Math.cos((a0 + a1) / 2), 0.3, Math.sin((a0 + a1) / 2)];
      const k = 1 - shade + shade * 2 * ((i * 7) % segments) / segments;
      this.triFacing(p0, p1, [x, y + height, z], color.map((c) => c * k), out);
    }
  }

  // Vertical cylinder (posts, trunks), open at both ends.
  cylinder([x, y, z], radius, height, segments, color) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius];
      const b1 = [x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius];
      const t0 = [b0[0], y + height, b0[2]];
      const t1 = [b1[0], y + height, b1[2]];
      const out = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.triFacing(b0, b1, t1, color, out);
      this.triFacing(b0, t1, t0, color, out);
    }
  }

  // Axis-aligned box from min to max corner.
  box([x0, y0, z0], [x1, y1, z1], color) {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const faces = [[0, 1, 2, 3, [0, 0, -1]], [5, 4, 7, 6, [0, 0, 1]], [4, 0, 3, 7, [-1, 0, 0]], [1, 5, 6, 2, [1, 0, 0]], [3, 2, 6, 7, [0, 1, 0]], [4, 5, 1, 0, [0, -1, 0]]];
    for (const [a, b, d, e, out] of faces) {
      this.triFacing(c[a], c[b], c[d], color, out);
      this.triFacing(c[a], c[d], c[e], color, out);
    }
  }

  // Six-sided solid between a bottom and a top quad (each listed going round),
  // e.g. a torso that tapers from hips to shoulders.
  prism(bottom, top, color) {
    const centre = [...bottom, ...top].reduce((a, p) => a.map((v, i) => v + p[i] / 8), [0, 0, 0]);
    const face = (a, b, c, d) => {
      const out = sub([0, 1, 2].map((i) => (a[i] + b[i] + c[i] + d[i]) / 4), centre);
      this.triFacing(a, b, c, color, out);
      this.triFacing(a, c, d, color, out);
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      face(bottom[i], bottom[j], top[j], top[i]);
    }
    face(...top);
    face(...bottom);
  }

  // Low-poly ball (buoys).
  sphere([x, y, z], radius, color, rings = 5, segments = 8) {
    const point = (r, s) => {
      const phi = (r / rings) * Math.PI;
      const theta = (s / segments) * Math.PI * 2;
      return [x + Math.sin(phi) * Math.cos(theta) * radius, y + Math.cos(phi) * radius, z + Math.sin(phi) * Math.sin(theta) * radius];
    };
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = point(r, s);
        const b = point(r, s + 1);
        const c = point(r + 1, s + 1);
        const d = point(r + 1, s);
        const mid = point(r + 0.5, s + 0.5);
        const out = sub(mid, [x, y, z]);
        this.triFacing(a, b, c, color, out);
        this.triFacing(a, c, d, color, out);
      }
    }
  }

  build() {
    return { vertices: new Float32Array(this.data), count: this.count };
  }
}

// A marathon K1, about 5.2 m long, in boat space: x right, y up, -z forward.
// The paddler's eye sits just behind the origin.
export function kayakMesh({ deck, hull, stripe, cockpit = [0.05, 0.05, 0.06] }) {
  const m = new MeshBuilder();
  const bow = -3.3;
  const stern = 1.9;
  const stations = 28;
  const ring = (z) => {
    const t = (z - bow) / (stern - bow); // 0 at the bow, 1 at the stern
    const shape = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.75;
    const w = 0.235 * shape;
    const top = 0.05 + 0.1 * shape;
    return [
      [-w, 0.02, z], [-w * 0.55, top * 0.9, z], [0, top, z], [w * 0.55, top * 0.9, z],
      [w, 0.02, z], [w * 0.6, -0.12 * shape, z], [0, -0.15 * shape, z], [-w * 0.6, -0.12 * shape, z],
    ];
  };
  for (let i = 0; i < stations; i++) {
    const z0 = bow + ((stern - bow) * i) / stations;
    const z1 = bow + ((stern - bow) * (i + 1)) / stations;
    const a = ring(z0);
    const b = ring(z1);
    const inCockpit = (z0 + z1) / 2 > -0.55 && (z0 + z1) / 2 < 0.55;
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      const isDeck = k < 4;
      let color = isDeck ? deck : hull;
      if (isDeck && inCockpit && (k === 1 || k === 2)) color = cockpit;
      else if (isDeck && (k === 1 || k === 2) && !inCockpit) color = stripe;
      const out = [(a[k][0] + b[k2][0]) / 2, (a[k][1] + b[k2][1]) / 2, 0];
      m.triFacing(a[k], b[k], b[k2], color, out);
      m.triFacing(a[k], b[k2], a[k2], color, out);
    }
  }
  return m.build();
}

// A wing paddle, shaft along x, centred on the origin, blades facing -z.
export function paddleMesh({ shaft, blade }) {
  const m = new MeshBuilder();
  const half = 1.08;
  // Square-ish shaft: four long thin quads.
  const r = 0.016;
  const corners = [[0, r, r], [0, r, -r], [0, -r, -r], [0, -r, r]];
  for (let i = 0; i < 4; i++) {
    const [, y0, z0] = corners[i];
    const [, y1, z1] = corners[(i + 1) % 4];
    const out = [0, (y0 + y1) / 2, (z0 + z1) / 2];
    m.triFacing([-half, y0, z0], [half, y0, z0], [half, y1, z1], shaft, out);
    m.triFacing([-half, y0, z0], [half, y1, z1], [-half, y1, z1], shaft, out);
  }
  // Blades: a curved spoon at each end, slightly cupped towards -z.
  for (const side of [-1, 1]) {
    const x0 = side * (half - 0.42);
    const x1 = side * (half + 0.06);
    const cols = 6;
    for (let i = 0; i < cols; i++) {
      const f0 = i / cols;
      const f1 = (i + 1) / cols;
      const width = (f) => 0.03 + 0.12 * Math.sin(Math.PI * Math.min(1, f * 1.1)) ** 0.6;
      const cup = (f) => 0.03 * Math.sin(Math.PI * f);
      const xa = x0 + (x1 - x0) * f0;
      const xb = x0 + (x1 - x0) * f1;
      const a = [xa, -width(f0), -cup(f0)];
      const b = [xb, -width(f1), -cup(f1)];
      const c = [xb, width(f1) * 0.7, -cup(f1)];
      const d = [xa, width(f0) * 0.7, -cup(f0)];
      m.triFacing(a, b, c, blade, [0, 0, -1]);
      m.triFacing(a, c, d, blade, [0, 0, -1]);
    }
  }
  return m.build();
}

// A rival paddler from the hips up, in boat space, sitting at the cockpit:
// torso in their club top, head and cap. Arms are separate (see limbMesh).
export const SEAT = 0.15; // z of the paddler's hips
export const SHOULDER = { x: 0.2, y: 0.58 };
export function paddlerMesh({ top, skin, cap }) {
  const m = new MeshBuilder();
  const ring = (y, w, d) => [[-w, y, -d], [w, y, -d], [w, y, d], [-w, y, d]];
  m.prism(ring(0.08, 0.16, 0.11), ring(0.38, 0.17, 0.12), top);
  m.prism(ring(0.38, 0.17, 0.12), ring(SHOULDER.y + 0.02, 0.22, 0.1), top);
  m.cylinder([0, SHOULDER.y, 0], 0.05, 0.12, 6, skin);
  m.sphere([0, 0.77, -0.01], 0.105, skin, 5, 8);
  m.sphere([0, 0.81, 0.0], 0.1, cap, 3, 8);
  m.box([-0.08, 0.79, -0.15], [0.08, 0.805, -0.07], cap); // peak
  return m.build();
}

// A unit-length arm along +z, 1 unit across; a model matrix stretches it
// from shoulder to hand.
export function limbMesh(color) {
  const m = new MeshBuilder();
  m.box([-0.5, -0.5, 0], [0.5, 0.5, 1], color);
  return m.build();
}

// Flat grid of (x, z) points centred on the origin, for the water surface.
export function waterGrid(cells, size) {
  const step = size / cells;
  const half = size / 2;
  const out = new Float32Array(cells * cells * 6 * 2);
  let o = 0;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x0 = -half + i * step;
      const z0 = -half + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      out.set([x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1], o);
      o += 12;
    }
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}
