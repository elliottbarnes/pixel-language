export const PRESETS = [
  {
    name: 'Interference',
    note: 'Three oscillators, one continuous field.',
    source: `// Interference · a field of phase-shifted waves
let p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1);
let t = time * 0.32;
let a = sin(p.x * 9 + t);
let b = cos(p.y * 11 - t * 1.3);
let c = sin(length(p) * 15 - t * 2);
let field = (a + b + c) / 3;
let phase = field * 2.4 + vec3(0, 1.8, 3.9);
let color = 0.5 + 0.5 * cos(phase);
let glow = pow(1 - abs(field), 3);
output color * (0.35 + 0.65 * glow);`
  },
  {
    name: 'Orbital',
    note: 'Distance fields describe a tiny solar system.',
    source: `// Orbital · circles are just distances
let p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1);
let radius = length(p);
let ring = 1 - smoothstep(0.002, 0.006, abs(radius - 0.29));
let orbit = vec2(cos(time * 0.5), sin(time * 0.5)) * 0.29;
let moon = 1 - smoothstep(0.032, 0.036, length(p - orbit));
let sun = 1 - smoothstep(0.12, 0.126, radius);
let halo = exp(-radius * 7) * 0.6;
let base = vec3(0.016, 0.019, 0.039);
let solar = vec3(1, 0.43, 0.22) * (sun + halo);
let lunar = vec3(0.63, 0.78, 1) * (ring * 0.4 + moon);
output base + solar + lunar;`
  },
  {
    name: 'Contours',
    note: 'A moving topography built from nested sine waves.',
    source: `// Contours · a moving topographic map
let p = (uv - 0.5) * 5;
let t = time * 0.2;
let terrain = sin(p.x + sin(p.y + t)) + cos(p.y * 1.2 - t);
let bands = fract(terrain * 3);
let line = 1 - smoothstep(0.03, 0.1, bands);
let elevation = terrain * 0.25 + 0.5;
let valley = vec3(0.025, 0.08, 0.1);
let summit = vec3(0.12, 0.53, 0.43);
let color = mix(valley, summit, elevation);
output color + line * vec3(0.43, 0.87, 0.66);`
  },
  {
    name: 'Tessellation',
    note: 'Repeated cells become a breathing geometric pattern.',
    source: `// Tessellation · repeat a signed distance field
let grid = uv * vec2(8, 8);
let cell = fract(grid) - 0.5;
let id = floor(grid);
let wave = sin(id.x * 0.7 + id.y * 0.9 + time);
let size = 0.2 + wave * 0.11;
let shape = abs(cell.x) + abs(cell.y);
let diamond = 1 - smoothstep(size, size + 0.015, shape);
let hue = 0.5 + 0.5 * cos(vec3(0, 2, 4) + id.x * 0.2 + id.y * 0.2);
output mix(vec3(0.025, 0.028, 0.045), hue, diamond);`
  }
];
