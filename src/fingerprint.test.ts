import { describe, it, expect } from 'vitest';
import { fnv1a32, mulberry32 } from './hash.js';
import { fR, fA, fS, fL, coeffsForSpacing } from './forces.js';
import { deriveField, profileHash, choosePatternClass, ridgeSpacingFor, particleCountFor } from './field.js';
import { simulate } from './simulate.js';
import { extractRidges } from './ridges.js';
import { synthesize } from './synthesize.js';
import { boundaryValue } from './boundary.js';
import type { FingerprintProfile, PatternClass, Singularity } from './types.js';

// A small deterministic profile plus fast simulate options so the tests that
// run the full relaxation stay quick without changing the maths under test.
function profile(over: Partial<FingerprintProfile> = {}): FingerprintProfile {
  return {
    handle: '@alec',
    vision: 48,
    choice: 32,
    method: 20,
    totalMarks: 60,
    totalHandprints: 6,
    topSubtypes: ['constraint', 'goal'],
    handprints: [
      { sig: 'hp-new', markCount: 5, ts: '2026-06-03T10:00:00.000Z', vision: 3, choice: 1, method: 1 },
      { sig: 'hp-mid', markCount: 9, ts: '2026-06-01T09:00:00.000Z', vision: 2, choice: 4, method: 3 },
      { sig: 'hp-old', markCount: 2, ts: '2026-05-20T08:00:00.000Z', vision: 0, choice: 1, method: 1 },
    ],
    ...over,
  };
}

const FAST = { simulate: { iterations: 90, count: 360 } } as const;

describe('hash — deterministic seeding', () => {
  it('fnv1a32 is stable and distinguishes inputs', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'));
  });

  it('mulberry32 is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('forces — Kücken-Champod kernels', () => {
  const c = coeffsForSpacing(0.03);

  it('repulsion is positive, attraction is negative for r > 0', () => {
    for (const r of [0.005, 0.01, 0.02, 0.04]) {
      expect(fR(r, c)).toBeGreaterThan(0);
      expect(fA(r, c)).toBeLessThan(0);
    }
  });

  it('f_s is less attractive than f_l (chi weakens across-ridge attraction)', () => {
    for (const r of [0.01, 0.02, 0.03]) {
      expect(fS(r, c)).toBeGreaterThan(fL(r, c));
    }
  });

  it('coeffsForSpacing scales the length scale monotonically', () => {
    const fine = coeffsForSpacing(0.02);
    const coarse = coeffsForSpacing(0.05);
    // Coarser spacing -> larger lambda -> smaller decay constant (longer range).
    expect(coarse.eR).toBeLessThan(fine.eR);
    expect(coarse.cutoff).toBeGreaterThan(fine.cutoff);
  });
});

describe('field — profile to orientation field', () => {
  const singCounts: Record<PatternClass, number> = {
    arch: 0,
    'tented-arch': 2,
    'left-loop': 2,
    'right-loop': 2,
    whorl: 4,
    'double-loop': 4,
  };

  it('is deterministic: same profile -> same class and singularities', () => {
    const a = deriveField(profile());
    const b = deriveField(profile());
    expect(a.patternClass).toBe(b.patternClass);
    expect(a.singularities).toEqual(b.singularities);
    expect(a.ridgeSpacing).toBe(b.ridgeSpacing);
    expect(a.particleCount).toBe(b.particleCount);
  });

  it('produces a realistic singularity count for its class', () => {
    const field = deriveField(profile());
    const cores = field.singularities.filter((s: Singularity) => s.kind === 'core').length;
    const deltas = field.singularities.filter((s: Singularity) => s.kind === 'delta').length;
    expect(cores).toBeLessThanOrEqual(2);
    expect(deltas).toBeLessThanOrEqual(2);
    expect(field.singularities.length).toBe(singCounts[field.patternClass]);
  });

  it('chooses a class from the six canonical patterns', () => {
    const classes = new Set<PatternClass>();
    for (let i = 0; i < 40; i++) {
      classes.add(deriveField(profile({ handle: `@u${i}` })).patternClass);
    }
    const canonical: PatternClass[] = ['arch', 'tented-arch', 'left-loop', 'right-loop', 'whorl', 'double-loop'];
    for (const c of classes) expect(canonical).toContain(c);
    // A range of handles should surface more than one class.
    expect(classes.size).toBeGreaterThan(1);
  });

  it('vision-heavy profiles lean toward whorls, method-heavy toward arches', () => {
    let whorlV = 0;
    let archM = 0;
    const trials = 30;
    for (let i = 0; i < trials; i++) {
      const h = `@u${i}`;
      const v = deriveField(profile({ handle: h, vision: 90, choice: 5, method: 5 })).patternClass;
      const m = deriveField(profile({ handle: h, vision: 5, choice: 5, method: 90 })).patternClass;
      if (v === 'whorl' || v === 'double-loop') whorlV++;
      if (m === 'arch' || m === 'tented-arch') archM++;
    }
    // Each dominant type biases toward its family in most trials.
    expect(whorlV).toBeGreaterThan(trials / 2);
    expect(archM).toBeGreaterThan(trials / 2);
  });

  it('adding a mark preserves the class but perturbs the field (twin prints)', () => {
    const base = profile();
    const grown = profile({
      handprints: base.handprints.map((h, i) =>
        i === 0 ? { ...h, markCount: h.markCount + 1, method: h.method + 1 } : h
      ),
    });
    const a = deriveField(base);
    const b = deriveField(grown);
    expect(a.patternClass).toBe(b.patternClass);
    // The orientation must differ somewhere (perturbation moved a singularity /
    // added a bump), so the print is different-but-related.
    let differs = false;
    for (let gx = 1; gx < 6 && !differs; gx++) {
      for (let gy = 1; gy < 6; gy++) {
        if (Math.abs(a.theta(gx / 6, gy / 6) - b.theta(gx / 6, gy / 6)) > 1e-9) {
          differs = true;
          break;
        }
      }
    }
    expect(differs).toBe(true);
  });

  it('ridge spacing tightens and particle count grows with more marks', () => {
    expect(ridgeSpacingFor(500)).toBeLessThan(ridgeSpacingFor(5));
    expect(particleCountFor(ridgeSpacingFor(500))).toBeGreaterThan(particleCountFor(ridgeSpacingFor(5)));
  });
});

describe('simulate — the relaxation converges', () => {
  it('mean per-step displacement falls well below its early value', () => {
    const field = deriveField(profile());
    const state = simulate(field, { iterations: 160, count: 400 });
    const history = state.displacementHistory;
    expect(history.length).toBeGreaterThan(20);
    const early = history.slice(2, 12).reduce((a, b) => a + b, 0) / 10;
    const late = history.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(late).toBeLessThan(early * 0.6);
    // Settled: final mean displacement is a small fraction of the ridge spacing.
    expect(state.finalDisplacement).toBeLessThan(0.1 * field.ridgeSpacing);
  });

  it('early stops once the convergence threshold is reached', () => {
    const field = deriveField(profile());
    const state = simulate(field, { iterations: 400, count: 360, convergence: 5e-3 });
    expect(state.iterations).toBeLessThan(400);
  });
});

describe('synthesize — the print', () => {
  it('is byte-identical for identical profiles (a true signature)', () => {
    const a = synthesize(profile(), FAST);
    const b = synthesize(profile(), FAST);
    expect(a.svgPaths).toEqual(b.svgPaths);
  });

  it('changes when a handprint is added (sensitivity)', () => {
    const base = synthesize(profile(), FAST);
    const grown = synthesize(
      profile({
        totalMarks: 61,
        totalHandprints: 7,
        handprints: [
          { sig: 'hp-newest', markCount: 1, ts: '2026-06-04T12:00:00.000Z', vision: 1, choice: 0, method: 0 },
          ...profile().handprints,
        ],
      }),
      FAST
    );
    expect(grown.svgPaths).not.toEqual(base.svgPaths);
  });

  it('changes when a mark is removed from a handprint (sensitivity both ways)', () => {
    const base = synthesize(profile(), FAST);
    const shrunk = synthesize(
      profile({
        totalMarks: 59,
        handprints: profile().handprints.map((h, i) =>
          i === 1 ? { ...h, markCount: h.markCount - 1, method: h.method - 1 } : h
        ),
      }),
      FAST
    );
    expect(shrunk.svgPaths).not.toEqual(base.svgPaths);
  });

  it('differs for a different handle (unique per person)', () => {
    const a = synthesize(profile(), FAST);
    const b = synthesize(profile({ handle: '@someone-else' }), FAST);
    expect(a.svgPaths).not.toEqual(b.svgPaths);
  });

  it('produces a sane number of ridges, all inside the fingertip boundary', () => {
    const print = synthesize(profile(), FAST);
    expect(print.ridges.length).toBeGreaterThan(4);
    expect(print.ridges.length).toBeLessThan(200);
    for (const ridge of print.ridges) {
      for (const p of ridge.points) {
        // A small tolerance for the smoothing pass nudging points outward.
        expect(boundaryValue(p)).toBeLessThan(1.15);
      }
    }
    for (const m of print.minutiae) {
      expect(['ending', 'bifurcation']).toContain(m.kind);
    }
  });

  it('every SVG path is a valid path string', () => {
    const print = synthesize(profile(), FAST);
    for (const d of print.svgPaths) {
      expect(d).toMatch(/^M-?\d/);
      expect(d).toMatch(/[MLCZ]/);
    }
  });

  it('does not throw on an empty (unmarked) profile', () => {
    const empty = profile({
      vision: 0,
      choice: 0,
      method: 0,
      totalMarks: 0,
      totalHandprints: 0,
      topSubtypes: [],
      handprints: [],
    });
    expect(() => synthesize(empty, FAST)).not.toThrow();
    const print = synthesize(empty, FAST);
    expect(print.svgPaths.length).toBeGreaterThan(0);
  });

  it('profileHash is stable and order-independent over handprints', () => {
    const p = profile();
    const reordered = profile({ handprints: [...p.handprints].reverse() });
    expect(profileHash(p)).toBe(profileHash(reordered));
  });
});

describe('choosePatternClass — deterministic pick', () => {
  it('returns the same class for the same hash and profile', () => {
    const p = profile();
    const h = profileHash(p);
    expect(choosePatternClass(p, h)).toBe(choosePatternClass(p, h));
  });
});
