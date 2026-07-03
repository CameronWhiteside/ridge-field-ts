// Ridge extraction: turn the settled particle cloud into long, continuous ridge
// polylines with a few emergent minutiae.
//
// The relaxation (simulate.ts) is what decides WHERE ridges are: it packs the
// particles into equidistant lines. This extractor then reads those lines out as
// continuous ridges by walking the local ridge direction s THROUGH the settled
// cloud: at each small step it advances along s and snaps laterally onto the
// nearest supporting particle, so the ridge rides the density the relaxation
// produced rather than a bare field streamline. A ridge stops when it runs off
// the supporting particles (an interior ENDING) or reaches the boundary. Where a
// ridge terminus abuts the body of another ridge, that is a BIFURCATION. The
// result is combed, roughly-parallel ink that curves around the cores and
// deltas, the way a rolled print reads.

import type { Minutia, OrientationField, ParticleState, Ridge, Vec2 } from './types.js';
import { boundaryValue, FINGERTIP, type Boundary } from './boundary.js';

interface Grid {
  cell: number;
  cols: number;
  buckets: Map<number, number[]>;
}

function keyOf(cx: number, cy: number, cols: number): number {
  return cy * cols + cx;
}

function buildGrid(pts: Vec2[], cell: number): Grid {
  const cols = Math.max(1, Math.ceil(1 / cell) + 1);
  const buckets = new Map<number, number[]>();
  pts.forEach((p, i) => {
    const k = keyOf(Math.floor(p.x / cell), Math.floor(p.y / cell), cols);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  });
  return { cell, cols, buckets };
}

/** Nearest point index to (px, py) within `radius`, or -1. Skips `used` points
 *  when `skipUsed` is set. */
function nearest(
  px: number,
  py: number,
  pts: Vec2[],
  grid: Grid,
  radius: number,
  used?: Uint8Array
): number {
  const cx = Math.floor(px / grid.cell);
  const cy = Math.floor(py / grid.cell);
  const r2 = radius * radius;
  let best = -1;
  let bestD2 = r2;
  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      const arr = grid.buckets.get(keyOf(gx, gy, grid.cols));
      if (!arr) continue;
      for (const k of arr) {
        if (used && used[k]) continue;
        const dx = pts[k].x - px;
        const dy = pts[k].y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = k;
        }
      }
    }
  }
  return best;
}

export interface ExtractOptions {
  boundary?: Boundary;
  /** Trace step length as a multiple of ridge spacing. */
  step?: number;
  /** Lateral snap search radius as a multiple of ridge spacing. */
  snapWindow?: number;
  /** How strongly a step is pulled onto its supporting particle (0..1). */
  snapStrength?: number;
  /** A step must have a particle within this (× spacing) or the ridge ends. */
  capture?: number;
  /** Particles within this (× spacing) of a ridge are consumed (sets density). */
  consume?: number;
  /** Drop ridges shorter than this many points. */
  minPoints?: number;
}

const DEFAULTS = {
  step: 0.5,
  snapWindow: 1.15,
  snapStrength: 0.65,
  capture: 1.2,
  // Consuming a lane a little under half the ridge-to-ridge gap (~2.35x spacing)
  // leaves the neighbouring ridge's particles free for their own trace, so the
  // print combs out into evenly spaced parallel ridges.
  consume: 0.95,
  minPoints: 6,
} as const;

interface Extracted {
  ridges: Ridge[];
  minutiae: Minutia[];
}

/**
 * Trace continuous ridges from the settled cloud. Deterministic given the
 * particle state and field (particles are visited in their stable seed order).
 */
export function extractRidges(
  state: ParticleState,
  field: OrientationField,
  opts: ExtractOptions = {}
): Extracted {
  const boundary = opts.boundary ?? FINGERTIP;
  const spacing = state.ridgeSpacing;
  const step = (opts.step ?? DEFAULTS.step) * spacing;
  const snapWindow = (opts.snapWindow ?? DEFAULTS.snapWindow) * spacing;
  const snapStrength = opts.snapStrength ?? DEFAULTS.snapStrength;
  const capture = (opts.capture ?? DEFAULTS.capture) * spacing;
  const consume = (opts.consume ?? DEFAULTS.consume) * spacing;
  const minPoints = opts.minPoints ?? DEFAULTS.minPoints;

  const pts: Vec2[] = state.particles.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  if (n === 0) return { ridges: [], minutiae: [] };

  const grid = buildGrid(pts, Math.max(snapWindow, capture, consume));
  const used = new Uint8Array(n);
  const consume2 = consume * consume;
  const maxSteps = Math.ceil(2.4 / step); // a ridge cannot exceed ~2.4 domain units

  const markUsed = (px: number, py: number): void => {
    const cx = Math.floor(px / grid.cell);
    const cy = Math.floor(py / grid.cell);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const arr = grid.buckets.get(keyOf(gx, gy, grid.cols));
        if (!arr) continue;
        for (const k of arr) {
          const dx = pts[k].x - px;
          const dy = pts[k].y - py;
          if (dx * dx + dy * dy < consume2) used[k] = 1;
        }
      }
    }
  };

  // Walk one direction from a start point; `sign` picks +s or -s. Returns the
  // stepped points (excluding the start) and consumes the particles it rides.
  const traceDir = (sx: number, sy: number, sign: number): Vec2[] => {
    const out: Vec2[] = [];
    let cx = sx;
    let cy = sy;
    const s0 = field.s(sx, sy);
    let pdx = s0.x * sign;
    let pdy = s0.y * sign;
    for (let i = 0; i < maxSteps; i++) {
      const s = field.s(cx, cy);
      // s is a director (+/- ambiguous): keep it aligned with the last step.
      let sdx = s.x;
      let sdy = s.y;
      if (sdx * pdx + sdy * pdy < 0) {
        sdx = -sdx;
        sdy = -sdy;
      }
      let nx = cx + sdx * step;
      let ny = cy + sdy * step;
      // Lateral snap onto the nearest supporting particle (perp to s).
      const j = nearest(nx, ny, pts, grid, snapWindow);
      if (j < 0) break; // ran off the density -> ridge ends
      const lx = -sdy;
      const ly = sdx;
      const lat = (pts[j].x - nx) * lx + (pts[j].y - ny) * ly;
      nx += lx * lat * snapStrength;
      ny += ly * lat * snapStrength;
      // Must stay supported and inside the fingertip.
      if (nearest(nx, ny, pts, grid, capture) < 0) break;
      if (boundaryValue({ x: nx, y: ny }, boundary) > 1) break;
      out.push({ x: nx, y: ny });
      markUsed(nx, ny);
      pdx = nx - cx;
      pdy = ny - cy;
      cx = nx;
      cy = ny;
    }
    return out;
  };

  const ridges: Ridge[] = [];
  const endpoints: Vec2[] = [];
  const minSpan = 2.5 * spacing;

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const start = pts[i];
    used[i] = 1;
    const fwd = traceDir(start.x, start.y, 1);
    const bwd = traceDir(start.x, start.y, -1);
    markUsed(start.x, start.y);
    const line = [...bwd.reverse(), { x: start.x, y: start.y }, ...fwd];
    if (line.length < minPoints) continue;
    const span = Math.hypot(line[0].x - line[line.length - 1].x, line[0].y - line[line.length - 1].y);
    if (span < minSpan && line.length < minPoints * 2) continue;
    ridges.push({ points: smooth(line, false), closed: false });
    endpoints.push(line[0], line[line.length - 1]);
  }

  // Minutiae: an interior ridge terminus is an ENDING, unless it abuts the body
  // of another ridge (a BIFURCATION). With continuous tracing most ridges run to
  // the boundary, so these stay the exception, not the texture.
  const bodyPts: Vec2[] = [];
  const bodyRidge: number[] = [];
  ridges.forEach((ridge, ri) => {
    for (const p of ridge.points) {
      bodyPts.push(p);
      bodyRidge.push(ri);
    }
  });
  const bodyGrid = buildGrid(bodyPts, 1.3 * spacing);
  const edgeBand = 0.8;
  const abut2 = (1.2 * spacing) * (1.2 * spacing);
  const minutiae: Minutia[] = [];
  ridges.forEach((ridge, ri) => {
    for (const end of [ridge.points[0], ridge.points[ridge.points.length - 1]]) {
      if (boundaryValue(end, boundary) >= edgeBand) continue; // reached the edge
      const near = nearestBody(end, bodyPts, bodyGrid, bodyRidge, ri, abut2);
      minutiae.push({ kind: near ? 'bifurcation' : 'ending', at: end });
    }
  });

  return { ridges, minutiae };
}

/** True if a point of a DIFFERENT ridge sits within sqrt(r2) of `p`. */
function nearestBody(
  p: Vec2,
  bodyPts: Vec2[],
  grid: Grid,
  bodyRidge: number[],
  selfRidge: number,
  r2: number
): boolean {
  const cx = Math.floor(p.x / grid.cell);
  const cy = Math.floor(p.y / grid.cell);
  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      const arr = grid.buckets.get(keyOf(gx, gy, grid.cols));
      if (!arr) continue;
      for (const k of arr) {
        if (bodyRidge[k] === selfRidge) continue;
        const dx = bodyPts[k].x - p.x;
        const dy = bodyPts[k].y - p.y;
        if (dx * dx + dy * dy < r2) return true;
      }
    }
  }
  return false;
}

/** Laplacian smoothing of a polyline: a couple of passes nudging each interior
 *  point toward the average of its neighbours (endpoints pinned). */
function smooth(points: Vec2[], closed: boolean, passes = 2, factor = 0.5): Vec2[] {
  if (points.length < 3) return points;
  let cur = points.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.map((p) => ({ x: p.x, y: p.y }));
    const start = closed ? 0 : 1;
    const end = closed ? cur.length : cur.length - 1;
    for (let i = start; i < end; i++) {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[(i + 1) % cur.length];
      next[i] = {
        x: cur[i].x + factor * ((a.x + b.x) / 2 - cur[i].x),
        y: cur[i].y + factor * ((a.y + b.y) / 2 - cur[i].y),
      };
    }
    cur = next;
  }
  return cur;
}
