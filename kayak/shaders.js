// WGSL for the three pipelines. They share one per-frame uniform block.

const FRAME = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  camPos: vec4f,     // xyz, w = time in seconds
  camRight: vec4f,   // xyz, w = tan(horizontal fov / 2)
  camUp: vec4f,      // xyz, w = tan(vertical fov / 2)
  camFwd: vec4f,
  sunDir: vec4f,     // towards the sun
  skyTop: vec4f,
  skyHorizon: vec4f, // also the fog colour; w = fog density
  water: vec4f,      // deep water colour
};
@group(0) @binding(0) var<uniform> frame: Frame;

fn fog(color: vec3f, dist: f32) -> vec3f {
  let f = 1.0 - exp(-dist * frame.skyHorizon.w);
  return mix(color, frame.skyHorizon.rgb, clamp(f, 0.0, 1.0));
}

fn skyColor(dir: vec3f, halo: f32) -> vec3f {
  let h = clamp(dir.y, 0.0, 1.0);
  var c = mix(frame.skyHorizon.rgb, frame.skyTop.rgb, pow(h, 0.55));
  let sun = max(dot(dir, frame.sunDir.xyz), 0.0);
  c += vec3f(1.0, 0.86, 0.62) * (pow(sun, 3000.0) * 8.0 + pow(sun, 48.0) * 0.2) * halo;
  return c;
}
`;

export const SKY = FRAME + /* wgsl */ `
struct Out { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: Out;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.ndc = p[i];
  return o;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let dir = normalize(frame.camFwd.xyz
    + in.ndc.x * frame.camRight.xyz * frame.camRight.w
    + in.ndc.y * frame.camUp.xyz * frame.camUp.w);
  // Below the horizon the far-off river fades into the haze.
  let below = mix(frame.skyHorizon.rgb, frame.water.rgb, 0.25);
  let c = select(skyColor(dir, 1.0), below, dir.y < 0.0);
  return vec4f(c, 1.0);
}
`;

export const MESH = FRAME + /* wgsl */ `
struct In {
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) m0: vec4f,
  @location(4) m1: vec4f,
  @location(5) m2: vec4f,
  @location(6) m3: vec4f,
};
struct Out {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
};

@vertex fn vs(v: In) -> Out {
  let model = mat4x4f(v.m0, v.m1, v.m2, v.m3);
  let world = model * vec4f(v.pos, 1.0);
  var o: Out;
  o.clip = frame.viewProj * world;
  o.world = world.xyz;
  o.normal = (model * vec4f(v.normal, 0.0)).xyz;
  o.color = v.color;
  return o;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let sun = max(dot(n, frame.sunDir.xyz), 0.0);
  let ambient = mix(vec3f(0.3, 0.27, 0.24), frame.skyTop.rgb * 0.7 + 0.25, 0.5 + 0.5 * n.y);
  let lit = in.color * (vec3f(1.0, 0.94, 0.82) * sun * 0.8 + ambient * 0.62);
  return vec4f(fog(lit, distance(in.world, frame.camPos.xyz)), 1.0);
}
`;

export const WATER = FRAME + /* wgsl */ `
struct Out { @builtin(position) clip: vec4f, @location(0) world: vec3f };

const SPACING = 2.0;

// A few travelling sine waves: small, choppy, never repeating obviously.
fn height(p: vec2f, t: f32) -> f32 {
  return 0.045 * sin(dot(p, vec2f(0.21, 0.13)) + t * 1.3)
       + 0.035 * sin(dot(p, vec2f(-0.17, 0.27)) + t * 1.7)
       + 0.02 * sin(dot(p, vec2f(0.53, -0.41)) + t * 2.6)
       + 0.012 * sin(dot(p, vec2f(-0.9, -0.7)) + t * 3.4);
}

@vertex fn vs(@location(0) grid: vec2f) -> Out {
  let snap = floor(frame.camPos.xz / SPACING) * SPACING;
  let xz = grid + snap;
  let world = vec3f(xz.x, height(xz, frame.camPos.w), xz.y);
  var o: Out;
  o.clip = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  return o;
}

// Fine ripples only exist in the normal, so they cost nothing in geometry.
fn ripple(p: vec2f, t: f32) -> vec2f {
  let a = cos(dot(p, vec2f(1.9, 1.3)) + t * 4.1) * vec2f(1.9, 1.3);
  let b = cos(dot(p, vec2f(-1.4, 2.3)) + t * 3.3) * vec2f(-1.4, 2.3);
  let c = cos(dot(p, vec2f(3.7, -2.9)) + t * 5.7) * vec2f(3.7, -2.9);
  return (a + b) * 0.03 + c * 0.014;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let t = frame.camPos.w;
  let p = in.world.xz;
  let e = 0.05;
  let dx = (height(p + vec2f(e, 0.0), t) - height(p - vec2f(e, 0.0), t)) / (2.0 * e);
  let dz = (height(p + vec2f(0.0, e), t) - height(p - vec2f(0.0, e), t)) / (2.0 * e);
  let r = ripple(p, t);
  let n = normalize(vec3f(-dx - r.x, 1.0, -dz - r.y));

  let toEye = frame.camPos.xyz - in.world;
  let dist = length(toEye);
  let v = toEye / dist;
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let refl = reflect(-v, n);
  let sky = skyColor(vec3f(refl.x, abs(refl.y), refl.z), 0.0);
  var c = mix(frame.water.rgb, sky, clamp(fresnel * 1.15, 0.0, 1.0));
  // Sun glitter: a tight highlight that the ripples break up into sparkles.
  c += vec3f(1.0, 0.9, 0.7) * pow(max(dot(refl, frame.sunDir.xyz), 0.0), 1200.0) * 2.0;
  return vec4f(fog(c, dist), 1.0);
}
`;
