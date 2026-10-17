// Brick debris on the GPU: a compute shader moves every particle, a render pass
// draws them as soft dots on a transparent WebGPU canvas laid over the game canvas.
// The CPU only writes freshly spawned particles into a ring buffer, so tens of
// thousands can be in the air at once. Same interface as particles-2d.js.

const MAX = 1 << 16; // ring buffer size; the oldest particles are overwritten first
const FLOATS = 12; // per particle, matching the WGSL struct below (48 bytes)
const WORKGROUP = 64;

const PARTICLE = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  life: f32,
  ttl: f32,
  size: f32,
  spin: f32,
};

struct Sim {
  field: vec2f,
  ball: vec2f,
  dt: f32,
  gravity: f32,
  push: f32,
  ballR: f32,
};

@group(0) @binding(0) var<uniform> sim: Sim;
`;

const COMPUTE = PARTICLE + /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(${WORKGROUP})
fn simulate(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&particles)) { return; }
  var p = particles[id.x];
  if (p.life <= 0.0) { return; }

  let dt = sim.dt;
  p.life -= dt;
  p.vel.y += sim.gravity * dt;
  p.vel *= exp(-1.1 * dt); // air drag

  // The ball shoves debris out of its way.
  let away = p.pos - sim.ball;
  let dist = length(away);
  let reach = sim.ballR * 4.0;
  if (dist < reach && dist > 0.001) {
    p.vel += away / dist * sim.push * (1.0 - dist / reach) * dt;
  }

  // A little swirl so bursts don't look like plain ballistic sprays.
  p.vel += vec2f(-p.vel.y, p.vel.x) * p.spin * dt;
  p.pos += p.vel * dt;

  // Settle on the floor and bounce off the side walls.
  let ground = sim.field.y - p.size;
  if (p.pos.y > ground) {
    p.pos.y = ground;
    p.vel = vec2f(p.vel.x * 0.8, -p.vel.y * 0.3);
    p.spin = 0.0;
  }
  if (p.pos.x < 0.0 || p.pos.x > sim.field.x) {
    p.pos.x = clamp(p.pos.x, 0.0, sim.field.x);
    p.vel.x = -p.vel.x * 0.5;
  }
  particles[id.x] = p;
}
`;

const RENDER = PARTICLE + /* wgsl */ `
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  var corners = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  var out: Out;
  let p = particles[i];
  if (p.life <= 0.0) {
    out.pos = vec4f(2.0, 2.0, 0.0, 1.0); // dead: outside clip space, so culled
    return out;
  }
  let fade = clamp(p.life / p.ttl, 0.0, 1.0);
  let corner = corners[v];
  let at = p.pos + corner * p.size * (0.4 + 0.6 * fade);
  out.pos = vec4f(at.x / sim.field.x * 2.0 - 1.0, 1.0 - at.y / sim.field.y * 2.0, 0.0, 1.0);
  out.uv = corner;
  out.color = vec4f(p.color.rgb, p.color.a * fade);
  return out;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let a = in.color.a * (1.0 - d);
  return vec4f(in.color.rgb * a, a); // premultiplied
}
`;

// Resolves to a particle system, or null when WebGPU isn't available here.
export async function createGpuParticles(canvas, W, H) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const particleBuffer = device.createBuffer({
    size: MAX * FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const simBuffer = device.createBuffer({
    size: 8 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: COMPUTE }), entryPoint: 'simulate' },
  });
  const renderModule = device.createShaderModule({ code: RENDER });
  const additive = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: {
      module: renderModule,
      entryPoint: 'fs',
      targets: [{ format, blend: { color: additive, alpha: additive } }],
    },
  });
  const bindGroup = (pipeline) => device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: simBuffer } },
      { binding: 1, resource: { buffer: particleBuffer } },
    ],
  });
  const computeGroup = bindGroup(computePipeline);
  const renderGroup = bindGroup(renderPipeline);

  // Spawns are staged here and uploaded once per frame, wrapping around the ring.
  const staging = new Float32Array(MAX * FLOATS);
  let head = 0;
  let pending = 0;
  let alive = 0; // seconds until the longest-lived particle is gone
  let dirty = true; // the canvas needs redrawing even if nothing moves
  const sim = new Float32Array(8);

  new ResizeObserver(() => {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    dirty = true;
  }).observe(canvas);

  function upload() {
    if (!pending) return;
    const start = (head - pending + MAX) % MAX;
    const first = Math.min(pending, MAX - start);
    device.queue.writeBuffer(particleBuffer, start * FLOATS * 4, staging, start * FLOATS, first * FLOATS);
    if (pending > first) device.queue.writeBuffer(particleBuffer, 0, staging, 0, (pending - first) * FLOATS);
    pending = 0;
  }

  return {
    label: 'WebGPU',
    perBrick: 2400,
    lost: device.lost,

    // Fills a rect with debris flung outwards (and along the ball's direction).
    burst({ x, y, w, h }, [r, g, b], count, { vx = 0, vy = 0 } = {}) {
      count = Math.min(count, MAX);
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let n = 0; n < count; n++) {
        const o = head * FLOATS;
        const px = x + Math.random() * w;
        const py = y + Math.random() * h;
        const speed = 40 + Math.random() ** 2 * 320;
        const angle = Math.atan2(py - cy, px - cx) + (Math.random() - 0.5) * 1.2;
        const shade = 0.75 + Math.random() * 0.5;
        const ttl = 1.2 + Math.random() * 2.2;
        staging.set([
          px, py,
          Math.cos(angle) * speed + vx * 0.25, Math.sin(angle) * speed + vy * 0.25 - 60,
          Math.min(1, r * shade), Math.min(1, g * shade), Math.min(1, b * shade), 0.55,
          ttl, ttl, 1 + Math.random() * 2, (Math.random() - 0.5) * 3,
        ], o);
        head = (head + 1) % MAX;
        alive = Math.max(alive, ttl);
      }
      pending = Math.min(MAX, pending + count);
    },

    // dt is 0 while paused, which freezes everything in place.
    update(dt, ball) {
      if (!pending && !dirty && (alive <= 0 || dt === 0)) return;
      upload();
      sim.set([W, H, ball.x, ball.y, dt, 520, 9000, ball.r]);
      device.queue.writeBuffer(simBuffer, 0, sim);

      const encoder = device.createCommandEncoder();
      if (dt > 0) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, computeGroup);
        pass.dispatchWorkgroups(Math.ceil(MAX / WORKGROUP));
        pass.end();
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(renderPipeline);
      pass.setBindGroup(0, renderGroup);
      pass.draw(6, MAX);
      pass.end();
      device.queue.submit([encoder.finish()]);

      const wasAlive = alive > 0;
      alive = Math.max(0, alive - dt);
      dirty = wasAlive && alive === 0; // one more frame to clear away the last of them
    },

    draw() {}, // drawn on its own canvas in update()
  };
}
