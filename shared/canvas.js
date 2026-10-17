// Canvas helpers shared by the games: crisp high-DPI backing and theme colors.

// Keeps the canvas backed by real device pixels and scaled so the game can draw
// in fixed field units (w x h) regardless of how big it is on screen.
// Returns the 2D context.
export function fitCanvas(canvas, w, h) {
  const ctx = canvas.getContext('2d');
  new ResizeObserver(() => {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientWidth * dpr * (h / w));
    const scale = canvas.width / w;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }).observe(canvas);
  return ctx;
}

// Live view of CSS custom properties, e.g. themeColors({ ink: '--field-ink' }).ink.
// Re-reads when the color scheme flips.
export function themeColors(names) {
  const colors = {};
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    for (const [key, prop] of Object.entries(names)) colors[key] = css.getPropertyValue(prop).trim();
  };
  read();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', read);
  return colors;
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
