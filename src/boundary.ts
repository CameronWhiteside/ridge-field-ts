// The fingertip boundary in the unit domain. Particles seed inside it and
// ridges are clipped to it, so the print sits in an oval fingertip pad rather
// than a square. A superellipse (rounded-rectangle-to-ellipse family) gives a
// slightly fuller fingertip than a plain ellipse while staying convex.

import type { Vec2 } from './types';

export interface Boundary {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Superellipse exponent: 2 = ellipse, >2 fuller (more fingertip-like). */
  exponent: number;
}

export const FINGERTIP: Boundary = {
  cx: 0.5,
  cy: 0.5,
  rx: 0.46,
  ry: 0.485,
  exponent: 2.35,
};

/** Signed membership: <= 1 inside, 1 on the edge, > 1 outside. */
export function boundaryValue(p: Vec2, b: Boundary = FINGERTIP): number {
  const u = Math.abs((p.x - b.cx) / b.rx);
  const v = Math.abs((p.y - b.cy) / b.ry);
  return u ** b.exponent + v ** b.exponent;
}

export function isInside(p: Vec2, b: Boundary = FINGERTIP): boolean {
  return boundaryValue(p, b) <= 1;
}

/** Push a point back onto the boundary if it has drifted outside (radial clamp
 *  about the centre). Keeps the settling cloud within the fingertip. */
export function clampInside(p: Vec2, b: Boundary = FINGERTIP): Vec2 {
  const val = boundaryValue(p, b);
  if (val <= 1) return p;
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const scale = 1 / Math.pow(val, 1 / b.exponent);
  return { x: b.cx + dx * scale, y: b.cy + dy * scale };
}
