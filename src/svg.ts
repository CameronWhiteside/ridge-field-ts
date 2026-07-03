// Settled ridge polylines -> smooth SVG path strings. Ridges are mapped from
// the unit domain onto the glyph's fingertip ellipse and smoothed with a
// Catmull-Rom spline (rendered as cubic Béziers) so the ink reads as flowing
// ridge lines, not faceted polylines. Monochrome by design: a fingerprint is
// ink on paper, so no per-ridge colour is emitted here.

import type { Ridge, Vec2 } from './types.js';
import { FINGERTIP, type Boundary } from './boundary.js';

export interface SvgView {
  width: number;
  height: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Default glyph view: a 200x240 frame with the fingertip ellipse inside it. */
export const DEFAULT_VIEW: SvgView = {
  width: 200,
  height: 240,
  cx: 100,
  cy: 124,
  rx: 78,
  ry: 100,
};

/** Build a view of a given pixel width, preserving the default aspect ratio. */
export function viewOfWidth(width: number): SvgView {
  const scale = width / DEFAULT_VIEW.width;
  return {
    width,
    height: DEFAULT_VIEW.height * scale,
    cx: DEFAULT_VIEW.cx * scale,
    cy: DEFAULT_VIEW.cy * scale,
    rx: DEFAULT_VIEW.rx * scale,
    ry: DEFAULT_VIEW.ry * scale,
  };
}

function mapPoint(p: Vec2, view: SvgView, b: Boundary): Vec2 {
  return {
    x: view.cx + ((p.x - b.cx) / b.rx) * view.rx,
    y: view.cy + ((p.y - b.cy) / b.ry) * view.ry,
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Catmull-Rom spline through `pts` as an SVG path. Open by default; `closed`
 * wraps the spline into a loop. Falls back to a polyline for < 3 points.
 */
function splinePath(pts: Vec2[], closed: boolean): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M${fmt(pts[0].x)},${fmt(pts[0].y)} L${fmt(pts[1].x)},${fmt(pts[1].y)}`;
  }
  const at = (i: number): Vec2 => {
    if (closed) return pts[(i + pts.length) % pts.length];
    return pts[Math.min(pts.length - 1, Math.max(0, i))];
  };
  const last = closed ? pts.length : pts.length - 1;
  let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  if (closed) d += ' Z';
  return d;
}

/** Emit smooth SVG `d` strings for the ridges in the given view. */
export function toSvgPaths(ridges: Ridge[], view: SvgView = DEFAULT_VIEW, boundary: Boundary = FINGERTIP): string[] {
  const paths: string[] = [];
  for (const ridge of ridges) {
    if (ridge.points.length < 2) continue;
    const mapped = ridge.points.map((p) => mapPoint(p, view, boundary));
    const d = splinePath(mapped, ridge.closed);
    if (d) paths.push(d);
  }
  return paths;
}
