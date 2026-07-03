// Core types for the synthetic-fingerprint library. Framework-agnostic: pure
// data shapes, no imports of Svelte, three.js, or app code. See README.md.

/** A 2D vector in the unit domain [0,1)^2 (or in view space, per context). */
export interface Vec2 {
  x: number;
  y: number;
}

/** The six canonical fingerprint pattern classes (Galton / Henry system). */
export type PatternClass =
  | 'arch'
  | 'tented-arch'
  | 'left-loop'
  | 'right-loop'
  | 'whorl'
  | 'double-loop';

/** A singularity of the orientation field: a core (loop centre) or delta
 *  (triangular ridge junction). Positions live in the unit domain. */
export interface Singularity {
  kind: 'core' | 'delta';
  at: Vec2;
}

/**
 * The orientation field that steers the anisotropic interaction. `s(x)` is the
 * smallest-stress direction (ridges run ALONG s); `l(x)` is perpendicular. The
 * field is built from a small set of singularities via the Sherlock-Monro
 * zero-pole model plus a background angle and per-handprint perturbations.
 */
export interface OrientationField {
  patternClass: PatternClass;
  singularities: Singularity[];
  /** Ridge spacing (domain units) the particle system relaxes toward. */
  ridgeSpacing: number;
  /** Particle count the simulation should use for this field. */
  particleCount: number;
  /** Smallest-stress direction at x (unit vector); ridges flow along this. */
  s(x: number, y: number): Vec2;
  /** Direction perpendicular to s at x (unit vector). */
  l(x: number, y: number): Vec2;
  /** Orientation angle theta at x (radians); s = (cos theta, sin theta). */
  theta(x: number, y: number): number;
}

/** A single Merkel cell in the interaction model. */
export interface Particle {
  x: number;
  y: number;
}

/** The settled particle cloud plus convergence diagnostics. */
export interface ParticleState {
  particles: Particle[];
  ridgeSpacing: number;
  /** Mean per-particle displacement on the final step (domain units). */
  finalDisplacement: number;
  /** Mean displacement recorded at each step (for convergence tests). */
  displacementHistory: number[];
  iterations: number;
}

/** A minutia: the two fingerprint-defining ridge events. */
export interface Minutia {
  kind: 'ending' | 'bifurcation';
  at: Vec2;
}

/** A single extracted ridge as an ordered polyline in the unit domain. */
export interface Ridge {
  points: Vec2[];
  /** True when the ridge closes on itself (a loop). */
  closed: boolean;
}

/** The profile data the field derivation reads. Mirrors the app's RidgeSeed but
 *  is defined independently so the library carries no app dependency. */
export interface FingerprintHandprint {
  sig: string;
  markCount: number;
  /** ISO timestamp of the handprint's latest mark. */
  ts: string;
  vision: number;
  choice: number;
  method: number;
}

export interface FingerprintProfile {
  handle: string;
  vision: number;
  choice: number;
  method: number;
  totalMarks: number;
  totalHandprints: number;
  /** Leading subtype short labels (informational; seeds minor detail). */
  topSubtypes: string[];
  handprints: FingerprintHandprint[];
}

/** The full result of synthesizing a print from a profile. */
export interface FingerprintPrint {
  field: OrientationField;
  ridges: Ridge[];
  minutiae: Minutia[];
  /** SVG path `d` strings in view space of the requested size. */
  svgPaths: string[];
  patternClass: PatternClass;
  /** Milliseconds the relaxation took (for perf reporting). */
  settleMs: number;
}
