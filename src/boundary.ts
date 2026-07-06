// The fingertip boundary in the unit domain. Particles seed inside it and
// ridges are clipped to it, so the print sits in an oval fingertip pad rather
// than a square. A superellipse (rounded-rectangle-to-ellipse family) gives a
// slightly fuller fingertip than a plain ellipse while staying convex.

import type { Vec2 } from './types.js';

export interface Boundary {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Superellipse exponent: 2 = ellipse, >2 fuller (more fingertip-like). */
  exponent: number;
  /** True square (L-infinity): fills the rx/ry box with crisp corners.
   *  When set, `exponent` is ignored. */
  square?: boolean;
}

export const FINGERTIP: Boundary = {
  cx: 0.5,
  cy: 0.5,
  rx: 0.46,
  ry: 0.485,
  exponent: 2.35,
};

/** A full square domain: ridges fill the box edge-to-edge with crisp corners. */
export const SQUARE: Boundary = {
  cx: 0.5,
  cy: 0.5,
  rx: 0.47,
  ry: 0.47,
  exponent: 2,
  square: true,
};

/** Signed membership: <= 1 inside, 1 on the edge, > 1 outside. */
export function boundaryValue(p: Vec2, b: Boundary = FINGERTIP): number {
  const u = Math.abs((p.x - b.cx) / b.rx);
  const v = Math.abs((p.y - b.cy) / b.ry);
  if (b.square) return Math.max(u, v);
  return u ** b.exponent + v ** b.exponent;
}

/** Approximate unit-domain area of the boundary. Exact for a square; the
 *  ellipse approximation is used for the superellipse family (consistent with
 *  how the particle count is sized). Used to hold ridge density constant as the
 *  domain shape changes. */
export function boundaryArea(b: Boundary = FINGERTIP): number {
  return b.square ? 4 * b.rx * b.ry : Math.PI * b.rx * b.ry;
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
  // Square: val is the max axis ratio, so 1/val lands the dominant axis on the
  // edge. Superellipse: invert the exponent to land radially on the curve.
  const scale = b.square ? 1 / val : 1 / Math.pow(val, 1 / b.exponent);
  return { x: b.cx + dx * scale, y: b.cy + dy * scale };
}
