// Hand-written WebGPU renderer: a sky pass, the water surface and any number
// of lit low-poly meshes, each drawn with per-instance model matrices.
import { SKY, MESH, WATER } from './shaders.js';
import { waterGrid } from './meshes.js';

const SAMPLES = 4; // MSAA
const FRAME_BYTES = 16 * 4 + 24 * 16;
// Resolution follows the GPU: if frames take longer than this to draw, render
// fewer pixels (down to half the screen's density); when there's room again,
// creep back up. Phones start lower, since their screens are dense and small.
const BUDGET_MS = 11;
const MAX_DPR = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;

export async function createRenderer(canvas) {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU graphics adapter was found.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const frameBuffer = device.createBuffer({ size: FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });

  const pipeline = (code, buffers, depth) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs', buffers },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', ...depth },
      multisample: { count: SAMPLES },
    });
  };

  const sky = pipeline(SKY, [], { depthWriteEnabled: false, depthCompare: 'always' });
  const water = pipeline(WATER, [
    { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
  ], { depthWriteEnabled: true, depthCompare: 'less' });
  const mesh = pipeline(MESH, [
    {
      arrayStride: 36,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' },
      ],
    },
    {
      arrayStride: 64,
      stepMode: 'instance',
      attributes: [0, 1, 2, 3].map((i) => ({ shaderLocation: 3 + i, offset: i * 16, format: 'float32x4' })),
    },
  ], { depthWriteEnabled: true, depthCompare: 'less' });

  const grid = waterGrid(260, 520);
  const gridBuffer = upload(device, grid, GPUBufferUsage.VERTEX);
  const gridCount = grid.length / 2;

  let color = null;
  let depth = null;
  let scale = 1; // share of the full resolution we draw at
  let gpuMs = 0; // smoothed time from submitting a frame to the GPU finishing it
  let measuring = false;
  let settled = 0; // seconds since the last change of scale
  let lastDraw = performance.now();

  function adapt(now) {
    settled += Math.min(0.1, (now - lastDraw) / 1000);
    lastDraw = now;
    if (settled < 1.5) return;
    if (gpuMs > BUDGET_MS && scale > 0.5) scale = Math.max(0.5, scale * 0.85);
    else if (gpuMs < BUDGET_MS * 0.5 && scale < 1 && settled > 4) scale = Math.min(1, scale * 1.1);
    else return;
    settled = 0;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR) * scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (color && canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    color?.destroy();
    depth?.destroy();
    color = device.createTexture({ size: [w, h], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    depth = device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  return {
    device,

    // A mesh from meshes.js, drawn with up to `maxInstances` model matrices.
    createMesh({ vertices, count }, maxInstances = 1) {
      return {
        vertices: upload(device, vertices, GPUBufferUsage.VERTEX),
        count,
        instances: device.createBuffer({ size: 64 * maxInstances, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
        instanceCount: 0,
      };
    },

    // Sets a mesh's model matrices for the next frames (an array of Float32Array(16)).
    place(m, matrices) {
      m.scratch ??= new Float32Array(m.instances.size / 4);
      matrices.forEach((mat, i) => m.scratch.set(mat, i * 16));
      device.queue.writeBuffer(m.instances, 0, m.scratch, 0, matrices.length * 16);
      m.instanceCount = matrices.length;
    },

    // frameData: Float32Array laid out like the WGSL Frame struct.
    draw(frameData, meshes) {
      adapt(performance.now());
      resize();
      device.queue.writeBuffer(frameBuffer, 0, frameData);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: color.createView(),
          resolveTarget: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'discard',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(sky);
      pass.draw(3);
      pass.setPipeline(mesh);
      for (const m of meshes) {
        if (!m.instanceCount) continue;
        pass.setVertexBuffer(0, m.vertices);
        pass.setVertexBuffer(1, m.instances);
        pass.draw(m.count, m.instanceCount);
      }
      pass.setPipeline(water);
      pass.setVertexBuffer(0, gridBuffer);
      pass.draw(gridCount);
      pass.end();
      device.queue.submit([encoder.finish()]);
      if (!measuring) {
        measuring = true;
        const t0 = performance.now();
        device.queue.onSubmittedWorkDone().then(() => {
          gpuMs += (performance.now() - t0 - gpuMs) * 0.2;
          measuring = false;
        });
      }
    },

    // For the debug hook: how the adaptive resolution is doing.
    get stats() {
      return { scale, gpuMs, width: canvas.width, height: canvas.height };
    },

    get aspect() {
      return canvas.clientWidth / Math.max(1, canvas.clientHeight);
    },
  };
}

function upload(device, data, usage) {
  const buffer = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
