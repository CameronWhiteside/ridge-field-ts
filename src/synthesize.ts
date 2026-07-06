// One-call convenience: profile -> a fully synthesized fingerprint print. Runs
// the real relaxation (deriveField -> simulate -> extractRidges -> toSvgPaths)
// and reports the settle time so callers can budget it.

import type { FingerprintPrint, FingerprintProfile } from './types.js';
import { deriveField, profileHash } from './field.js';
import { simulate, type SimulateOptions } from './simulate.js';
import { extractRidges, type ExtractOptions } from './ridges.js';
import { toSvgPaths, DEFAULT_VIEW, type SvgView } from './svg.js';
import type { Boundary } from './boundary.js';

export interface SynthesizeOptions {
  simulate?: SimulateOptions;
  extract?: ExtractOptions;
  view?: SvgView;
  /** Domain the ridges fill (default: the fingertip). Applied to the
   *  relaxation, ridge extraction, and the SVG mapping together. */
  boundary?: Boundary;
}

/** A monotonic clock that works in workers, jsdom and node. */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Synthesize a full print for a profile. Deterministic; identical profiles
 *  yield identical prints (same ridges, same SVG). */
export function synthesize(profile: FingerprintProfile, opts: SynthesizeOptions = {}): FingerprintPrint {
  const field = deriveField(profile);
  const t0 = now();
  const state = simulate(field, { ...opts.simulate, boundary: opts.simulate?.boundary ?? opts.boundary });
  const settleMs = now() - t0;
  const { ridges, minutiae } = extractRidges(state, field, {
    ...opts.extract,
    boundary: opts.extract?.boundary ?? opts.boundary,
  });
  const svgPaths = toSvgPaths(ridges, opts.view ?? DEFAULT_VIEW, opts.boundary);
  return {
    field,
    ridges,
    minutiae,
    svgPaths,
    patternClass: field.patternClass,
    settleMs,
  };
}

export { profileHash };
