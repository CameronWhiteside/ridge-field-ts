// The orientation field: profile data -> the global fingerprint pattern.
//
// The field is built from a SMALL, realistic set of singularities via the
// Sherlock-Monro zero-pole model:
//
//   theta(z) = theta_bg(z) + 1/2 * [ SUM_deltas arg(z - delta_k)
//                                    - SUM_cores  arg(z - core_k) ]
//
// with z = x + i y complex. Ridges run ALONG s = (cos theta, sin theta);
// l = (-sin theta, cos theta) is perpendicular. A core rotates the field by -pi
// as you circle it (a loop centre); a delta by +pi (a triangular junction).
//
// The SIGNATURE mapping (why a print is a person's own):
//  - A global hash H = hash(handle + sorted handprint sigs) seeds everything.
//  - A pattern CLASS is chosen from H, weighted by the profile's type mix
//    (method-heavy -> arch/structured, vision-heavy -> whorl, choice -> loop).
//    The class fixes a small template singularity set (0-2 cores, 0-2 deltas).
//  - Per-handprint detail lives in PERTURBATIONS: each handprint nudges the
//    nearest singularity and adds a small localized orientation bump at a hashed
//    location, magnitude from its recency and mass. Adding/removing one mark
//    shifts local minutiae but preserves the global class (the paper's
//    identical-twins analogy: shared field, differing minutiae).
//  - Ridge spacing and particle count scale from the total mark count / mass:
//    a denser profile grows a finer print.

import type {
  FingerprintProfile,
  OrientationField,
  PatternClass,
  Singularity,
  Vec2,
} from './types';
import { fnv1a32, mulberry32, subSeed, unitFloat } from './hash';

/** Domain centre the templates orbit (y increases downward, screen-like). */
const CENTRE: Vec2 = { x: 0.5, y: 0.52 };

const PATTERN_CLASSES: PatternClass[] = [
  'arch',
  'tented-arch',
  'left-loop',
  'right-loop',
  'whorl',
  'double-loop',
];

/** A localized orientation bump: a Gaussian-weighted rotation of the field. */
interface Bump {
  at: Vec2;
  sigma: number;
  amp: number;
}

/** Template singularities for each pattern class (unit-domain positions). */
function templateSingularities(cls: PatternClass): Singularity[] {
  const c = CENTRE;
  switch (cls) {
    case 'arch':
      return [];
    case 'tented-arch':
      return [
        { kind: 'core', at: { x: c.x, y: c.y - 0.05 } },
        { kind: 'delta', at: { x: c.x, y: c.y + 0.16 } },
      ];
    case 'left-loop':
      return [
        { kind: 'core', at: { x: c.x - 0.02, y: c.y - 0.06 } },
        { kind: 'delta', at: { x: c.x + 0.17, y: c.y + 0.14 } },
      ];
    case 'right-loop':
      return [
        { kind: 'core', at: { x: c.x + 0.02, y: c.y - 0.06 } },
        { kind: 'delta', at: { x: c.x - 0.17, y: c.y + 0.14 } },
      ];
    case 'whorl':
      return [
        { kind: 'core', at: { x: c.x, y: c.y - 0.08 } },
        { kind: 'core', at: { x: c.x, y: c.y + 0.04 } },
        { kind: 'delta', at: { x: c.x - 0.18, y: c.y + 0.16 } },
        { kind: 'delta', at: { x: c.x + 0.18, y: c.y + 0.16 } },
      ];
    case 'double-loop':
      return [
        { kind: 'core', at: { x: c.x - 0.08, y: c.y - 0.07 } },
        { kind: 'core', at: { x: c.x + 0.08, y: c.y + 0.07 } },
        { kind: 'delta', at: { x: c.x - 0.17, y: c.y + 0.13 } },
        { kind: 'delta', at: { x: c.x + 0.17, y: c.y - 0.11 } },
      ];
  }
}

/** Background arch bow (radians per unit x) for each class. Arches curve; loops
 *  and whorls take their curvature from singularities and stay flat behind. */
function archBow(cls: PatternClass): number {
  if (cls === 'arch') return 1.15;
  if (cls === 'tented-arch') return 0.7;
  return 0.0;
}

/**
 * Choose a pattern class from the global hash, weighted by the profile's type
 * mix. Vision biases toward whorls, choice toward loops, method toward arches.
 * The weights are deterministic; the hash picks within the weighted distribution.
 */
export function choosePatternClass(profile: FingerprintProfile, seed: number): PatternClass {
  // Weight by the DOMINANT type (a categorical, single-mark-stable feature)
  // rather than the exact ratios, so adding or removing one mark never flips the
  // class at a ratio boundary. Method -> arch/structured, vision -> whorl,
  // choice -> loop. The seed then picks within the weighted distribution.
  const dominant: 'vision' | 'choice' | 'method' =
    profile.vision >= profile.choice && profile.vision >= profile.method
      ? 'vision'
      : profile.choice >= profile.method
        ? 'choice'
        : 'method';

  const weights: Record<PatternClass, number> = {
    arch: 1,
    'tented-arch': 1,
    'left-loop': 1,
    'right-loop': 1,
    whorl: 1,
    'double-loop': 1,
  };
  if (dominant === 'method') {
    weights.arch = 4;
    weights['tented-arch'] = 3;
  } else if (dominant === 'choice') {
    weights['left-loop'] = 4;
    weights['right-loop'] = 4;
  } else {
    weights.whorl = 4;
    weights['double-loop'] = 2.5;
  }

  const sum = PATTERN_CLASSES.reduce((acc, k) => acc + weights[k], 0);
  // Deterministic pick: walk the cumulative distribution with the seed fraction.
  const pick = unitFloat(seed) * sum;
  let cursor = 0;
  for (const cls of PATTERN_CLASSES) {
    cursor += weights[cls];
    if (pick < cursor) return cls;
  }
  return PATTERN_CLASSES[PATTERN_CLASSES.length - 1];
}

/** Recency weight for a handprint at `rank` (0 = newest) of `n`: newest 1,
 *  oldest 0.3, linear in between. */
function recencyWeight(rank: number, n: number): number {
  if (n <= 1) return 1;
  return 1 - 0.7 * (rank / (n - 1));
}

/** Ridge spacing knob (domain units) from total marks: denser profile, finer
 *  print. This `spacing` sets the force length scale; the emergent ridge-to-
 *  ridge distance is ~2.35x it and the along-ridge cell distance ~1.0x it. */
export function ridgeSpacingFor(totalMarks: number): number {
  const detail = Math.log2(1 + Math.max(totalMarks, 0));
  const spacing = 0.03 - 0.0016 * detail;
  return Math.min(0.03, Math.max(0.019, spacing));
}

/** Particle count for a spacing: fill the fingertip ellipse to ~72% of the
 *  isotropic capacity, so cells relax into tight anisotropic ridge rows rather
 *  than collapsing (over-packing) or scattering (under-packing). Bounded for
 *  perf; the settle runs on the async precompute + fade path. */
export function particleCountFor(spacing: number): number {
  const ellipseArea = Math.PI * 0.46 * 0.48; // unit-domain fingertip ellipse
  const n = Math.round((0.72 * ellipseArea) / (spacing * spacing));
  return Math.min(1700, Math.max(400, n));
}

/**
 * Build the deterministic per-handprint perturbations: singularity nudges and
 * localized orientation bumps. Same handprints in, same perturbations out.
 */
function buildPerturbations(
  profile: FingerprintProfile,
  baseSingularities: Singularity[],
  seed: number
): { singularities: Singularity[]; bumps: Bump[] } {
  const singularities = baseSingularities.map((s) => ({ kind: s.kind, at: { ...s.at } }));
  const bumps: Bump[] = [];
  const n = profile.handprints.length;

  profile.handprints.forEach((hp, i) => {
    const w = recencyWeight(i, n);
    const mass = Math.min(Math.sqrt(Math.max(hp.markCount, 1)) / 4, 1);
    const hpHash = fnv1a32(`${seed >>> 0}:hp:${hp.sig}:${hp.markCount}:${hp.ts}`);
    const rng = mulberry32(hpHash);

    // Nudge the nearest singularity (if any) by a small hashed vector.
    if (singularities.length > 0) {
      const bx = rng();
      const by = rng();
      const loc: Vec2 = { x: 0.15 + bx * 0.7, y: 0.2 + by * 0.6 };
      let nearest = 0;
      let best = Infinity;
      singularities.forEach((s, si) => {
        const d = (s.at.x - loc.x) ** 2 + (s.at.y - loc.y) ** 2;
        if (d < best) {
          best = d;
          nearest = si;
        }
      });
      const mag = 0.012 * w * (0.5 + mass);
      const ang = rng() * Math.PI * 2;
      singularities[nearest].at.x += Math.cos(ang) * mag;
      singularities[nearest].at.y += Math.sin(ang) * mag;
    }

    // A small localized orientation bump at a hashed location -> local minutiae.
    const bumpX = 0.2 + rng() * 0.6;
    const bumpY = 0.22 + rng() * 0.56;
    const sign = rng() < 0.5 ? -1 : 1;
    bumps.push({
      at: { x: bumpX, y: bumpY },
      sigma: 0.08 + rng() * 0.05,
      amp: sign * (0.12 + 0.28 * w) * (0.4 + mass),
    });
  });

  // Keep singularities inside a sane central band so the class survives.
  for (const s of singularities) {
    s.at.x = Math.min(0.82, Math.max(0.18, s.at.x));
    s.at.y = Math.min(0.8, Math.max(0.2, s.at.y));
  }

  return { singularities, bumps };
}

/** The global hash H that seeds the whole print. */
export function profileHash(profile: FingerprintProfile): number {
  const sigs = profile.handprints
    .map((h) => `${h.sig}:${h.markCount}:${h.ts}:${h.vision},${h.choice},${h.method}`)
    .sort();
  const key = [
    profile.handle,
    `${profile.vision},${profile.choice},${profile.method}`,
    `${profile.totalMarks},${profile.totalHandprints}`,
    profile.topSubtypes.join('+'),
    sigs.join(';'),
  ].join('|');
  return fnv1a32(key);
}

/**
 * Derive the orientation field for a profile. Pure and deterministic: identical
 * profiles produce identical fields (and thus identical prints).
 */
/** A stable seed for the pattern-class pick: the handle alone. The class weights
 *  come from the (single-mark-stable) dominant type, so together the class is a
 *  pure function of handle + dominant type. Adding or removing one mark leaves
 *  both unchanged, preserving the global class; only the perturbations (seeded
 *  from the full profile hash) shift. This is the "identical twins" property. */
function classSeed(profile: FingerprintProfile): number {
  return fnv1a32(`${profile.handle}|class`);
}

export function deriveField(profile: FingerprintProfile): OrientationField {
  const h = profileHash(profile);
  const patternClass = choosePatternClass(profile, classSeed(profile));
  const bow = archBow(patternClass);
  const baseSingularities = templateSingularities(patternClass);
  const { singularities, bumps } = buildPerturbations(
    profile,
    baseSingularities,
    subSeed(h, 'perturb')
  );

  const cores = singularities.filter((s) => s.kind === 'core');
  const deltas = singularities.filter((s) => s.kind === 'delta');

  const ridgeSpacing = ridgeSpacingFor(profile.totalMarks);
  const particleCount = particleCountFor(ridgeSpacing);

  const theta = (x: number, y: number): number => {
    let t = bow * (x - CENTRE.x);
    for (const d of deltas) t += 0.5 * Math.atan2(y - d.at.y, x - d.at.x);
    for (const c of cores) t -= 0.5 * Math.atan2(y - c.at.y, x - c.at.x);
    for (const b of bumps) {
      const dx = x - b.at.x;
      const dy = y - b.at.y;
      t += b.amp * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
    }
    return t;
  };

  const s = (x: number, y: number): Vec2 => {
    const t = theta(x, y);
    return { x: Math.cos(t), y: Math.sin(t) };
  };
  const l = (x: number, y: number): Vec2 => {
    const t = theta(x, y);
    return { x: -Math.sin(t), y: Math.cos(t) };
  };

  return { patternClass, singularities, ridgeSpacing, particleCount, s, l, theta };
}
