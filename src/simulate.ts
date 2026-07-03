// The anisotropic interaction relaxation. Particles (Merkel cells) start from a
// seeded quasi-random cloud and evolve by explicit Euler under the Kücken-
// Champod force steered by the orientation field, until they self-organize into
// equidistant ridge lines flowing along s. Minutiae (bifurcations, endings)
// EMERGE from the relaxation; they are never drawn in by hand.
//
//   dx_j/dt = SUM over neighbors k of F(x_j - x_k, field at x_j)
//
// A uniform spatial-bucket grid (cell size = force cutoff) makes each step
// O(N * localNeighbors) rather than O(N^2).

import type { OrientationField, Particle, ParticleState, Vec2 } from './types';
import { coeffsForSpacing, fL, fS, type ForceCoeffs } from './forces';
import { clampInside, FINGERTIP, isInside, type Boundary } from './boundary';
import { mulberry32 } from './hash';

export interface SimulateOptions {
  /** Number of particles (defaults to field.particleCount). */
  count?: number;
  /** Integration steps (fixed budget). */
  iterations?: number;
  /** Euler time step. */
  dt?: number;
  /** uint32 seed for the initial cloud (deterministic). */
  seed?: number;
  boundary?: Boundary;
  /** Stop early once mean displacement falls below this (domain units). */
  convergence?: number;
}

const DEFAULTS = {
  iterations: 300,
  dt: 0.06,
  seed: 0x9e3779b9,
  convergence: 0,
} as const;

/** Seed `count` particles uniformly inside the boundary (rejection sampling). */
function seedParticles(count: number, seed: number, b: Boundary): Particle[] {
  const rng = mulberry32(seed);
  const particles: Particle[] = [];
  let guard = 0;
  while (particles.length < count && guard < count * 40) {
    guard += 1;
    const p: Vec2 = { x: rng(), y: rng() };
    if (isInside(p, b)) particles.push({ x: p.x, y: p.y });
  }
  return particles;
}

interface Grid {
  cell: number;
  cols: number;
  rows: number;
  buckets: number[][];
}

function buildGrid(particles: Particle[], cell: number): Grid {
  const cols = Math.max(1, Math.ceil(1 / cell) + 1);
  const rows = cols;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cell)));
    buckets[cy * cols + cx].push(i);
  }
  return { cell, cols, rows, buckets };
}

/** Net force on particle j from neighbors within the cutoff. */
function forceOn(
  j: number,
  particles: Particle[],
  grid: Grid,
  field: OrientationField,
  c: ForceCoeffs
): Vec2 {
  const pj = particles[j];
  const s = field.s(pj.x, pj.y);
  const l = field.l(pj.x, pj.y);
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(pj.x / grid.cell)));
  const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(pj.y / grid.cell)));
  const cutoff2 = c.cutoff * c.cutoff;
  let fx = 0;
  let fy = 0;

  for (let gy = cy - 1; gy <= cy + 1; gy++) {
    if (gy < 0 || gy >= grid.rows) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      if (gx < 0 || gx >= grid.cols) continue;
      const bucket = grid.buckets[gy * grid.cols + gx];
      for (const k of bucket) {
        if (k === j) continue;
        const dx = pj.x - particles[k].x;
        const dy = pj.y - particles[k].y;
        const r2 = dx * dx + dy * dy;
        if (r2 >= cutoff2 || r2 === 0) continue;
        const r = Math.sqrt(r2);
        const sd = s.x * dx + s.y * dy; // projection of d onto s
        const ld = l.x * dx + l.y * dy; // projection of d onto l
        // Full attraction (f_l formula) acts ALONG s so cells chain into tight
        // ridge lines in the s direction; the reduced coefficient (f_s formula,
        // with chi) acts across l so adjacent ridges stay spaced apart. This is
        // the arrangement the paper describes as "ridges run along s".
        const cAlong = fL(r, c);
        const cAcross = fS(r, c);
        fx += cAlong * sd * s.x + cAcross * ld * l.x;
        fy += cAlong * sd * s.y + cAcross * ld * l.y;
      }
    }
  }
  return { x: fx, y: fy };
}

/**
 * Relax the particle cloud to a near-stationary ridge state. Returns the
 * settled particles and a per-step mean-displacement history so convergence is
 * observable and testable.
 */
export function simulate(field: OrientationField, opts: SimulateOptions = {}): ParticleState {
  const boundary = opts.boundary ?? FINGERTIP;
  const spacing = field.ridgeSpacing;
  const coeffs = coeffsForSpacing(spacing);
  const count = opts.count ?? field.particleCount;
  const iterations = opts.iterations ?? DEFAULTS.iterations;
  const dt = opts.dt ?? DEFAULTS.dt;
  const seed = opts.seed ?? DEFAULTS.seed;
  const convergence = opts.convergence ?? DEFAULTS.convergence;
  const maxStep = 0.4 * spacing;

  const particles = seedParticles(count, seed, boundary);
  const displacementHistory: number[] = [];
  let finalDisplacement = 0;
  let ranIterations = 0;

  for (let step = 0; step < iterations; step++) {
    ranIterations = step + 1;
    const grid = buildGrid(particles, coeffs.cutoff);
    // Compute all displacements first (Euler: state frozen during the sweep).
    const disp: Vec2[] = new Array(particles.length);
    for (let j = 0; j < particles.length; j++) {
      const f = forceOn(j, particles, grid, field, coeffs);
      let sx = dt * f.x;
      let sy = dt * f.y;
      const mag = Math.hypot(sx, sy);
      if (mag > maxStep) {
        sx = (sx / mag) * maxStep;
        sy = (sy / mag) * maxStep;
      }
      disp[j] = { x: sx, y: sy };
    }
    let sumMag = 0;
    for (let j = 0; j < particles.length; j++) {
      const moved = clampInside(
        { x: particles[j].x + disp[j].x, y: particles[j].y + disp[j].y },
        boundary
      );
      particles[j].x = moved.x;
      particles[j].y = moved.y;
      sumMag += Math.hypot(disp[j].x, disp[j].y);
    }
    const mean = particles.length > 0 ? sumMag / particles.length : 0;
    displacementHistory.push(mean);
    finalDisplacement = mean;
    if (convergence > 0 && mean < convergence) break;
  }

  return {
    particles,
    ridgeSpacing: spacing,
    finalDisplacement,
    displacementHistory,
    iterations: ranIterations,
  };
}

/** Convenience: has the relaxation settled (final displacement small)? */
export function isSettled(state: ParticleState, threshold: number): boolean {
  return state.finalDisplacement <= threshold;
}
