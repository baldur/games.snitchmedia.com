// Fallback brick debris for browsers without WebGPU: a modest number of squares
// simulated in JS and drawn onto the game canvas. Same interface as particles-gpu.js.

const MAX = 1500;

export function create2dParticles(W, H) {
  const pool = [];

  return {
    label: 'Canvas 2D',
    perBrick: 40,

    burst({ x, y, w, h }, [r, g, b], count, { vx = 0, vy = 0 } = {}) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const color = `rgb(${r * 255} ${g * 255} ${b * 255})`;
      for (let n = 0; n < count; n++) {
        const px = x + Math.random() * w;
        const py = y + Math.random() * h;
        const speed = 40 + Math.random() ** 2 * 280;
        const angle = Math.atan2(py - cy, px - cx) + (Math.random() - 0.5) * 1.2;
        const ttl = 0.8 + Math.random() * 1.2;
        if (pool.length >= MAX) pool.shift();
        pool.push({
          x: px, y: py,
          vx: Math.cos(angle) * speed + vx * 0.25,
          vy: Math.sin(angle) * speed + vy * 0.25 - 60,
          life: ttl, ttl, size: 2 + Math.random() * 3, color,
        });
      }
    },

    update(dt) {
      if (!dt) return;
      const drag = Math.exp(-1.1 * dt);
      for (const p of pool) {
        p.life -= dt;
        p.vy += 520 * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > H - p.size) { p.y = H - p.size; p.vx *= 0.8; p.vy *= -0.3; }
        if (p.x < 0 || p.x > W) { p.x = Math.max(0, Math.min(W, p.x)); p.vx *= -0.5; }
      }
      for (let i = pool.length - 1; i >= 0; i--) if (pool[i].life <= 0) pool.splice(i, 1);
    },

    draw(ctx) {
      for (const p of pool) {
        const fade = p.life / p.ttl;
        const s = p.size * (0.4 + 0.6 * fade);
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    },
  };
}
