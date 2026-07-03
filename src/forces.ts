// The Kücken-Champod interaction force from Düring et al. (2019), "An
// anisotropic interaction model for simulating fingerprints" (J. Math. Biol.).
//
// Two isotropic radial kernels combine into an anisotropic force steered by the
// orientation field. Short range: repulsion (cells push apart). Long range:
// attraction (cells pull into chains). The stationary state is a set of
// equidistant ridge lines flowing along the smallest-stress direction s.
//
//   f_R(d) = (alpha * d^2 + beta) * exp(-e_R * d)     repulsion (positive)
//   f_A(d) = -gamma * d * exp(-e_A * d)               attraction (negative)
//   f_s(d) = chi * f_A(d) + f_R(d)                    reduced (chi weakens attr.)
//   f_l(d) = f_A(d) + f_R(d)                          full attraction
//
// The full anisotropic force between two cells separated by d, with local field
// axes s and l at the receiving cell, is F = f_s(|d|)(s.d)s + f_l(|d|)(l.d)l. In
// this implementation (see simulate.ts) the FULL kernel acts along s and the
// reduced kernel across l, so cells chain into tight ridge lines running along s
// (the paper's "ridges run along s") while adjacent ridges stay spaced apart.
//
// Paper params are alpha=270, beta=0.1, gamma=35, e_A=95, e_R=100, chi=0.2. We
// keep the paper's exact coefficient ratios but use chi=0.1 (a touch more
// anisotropy, so ridges read cleanly at a ~200px glyph) and expose a length
// SCALE: rescaling distance by lambda (spacing / base spacing) maps to
//   e_R' = e_R/lambda, e_A' = e_A/lambda, alpha' = alpha/lambda^2,
//   gamma' = gamma/lambda, beta' = beta,
// which stretches the equilibrium spacing by lambda while preserving the force
// SHAPE. The cutoff scales with the spacing too, so the whole system is
// self-similar in lambda.

export interface ForceCoeffs {
  alpha: number;
  beta: number;
  gamma: number;
  eA: number;
  eR: number;
  chi: number;
  /** Distance beyond which the force is treated as zero (neighbor cutoff). */
  cutoff: number;
}

/** Paper baseline coefficients (lambda = 1), with chi reduced to 0.1 for glyph-
 *  scale anisotropy. See BASE_SPACING for the empirical length calibration. */
export const BASE_COEFFS: Omit<ForceCoeffs, 'cutoff'> = {
  alpha: 270,
  beta: 0.1,
  gamma: 35,
  eA: 95,
  eR: 100,
  chi: 0.1,
};

/** Empirical length-calibration constant: the value of BASE_SPACING for which
 *  coeffsForSpacing(S) yields a settled cloud whose ANISOTROPIC lattice tracks
 *  S (along-ridge cell ~1.0*S, ridge-to-ridge ~2.35*S). Measured by relaxing a
 *  uniform field and reading back the spacings; see README "Calibration". */
export const BASE_SPACING = 0.00104;

/** Neighbor cutoff as a multiple of the ridge spacing. The paper's absolute
 *  cutoff of 0.5 is fine at its native (very fine) spacing, but at our rescaled
 *  spacing an absolute 0.5 would pull in the whole cloud and the attractive tail
 *  would collapse it. Limiting the reach to a few ridge spacings keeps the
 *  attraction local (chains and adjacent ridges) so repulsion can set spacing. */
export const CUTOFF_SPACINGS = 2.4;

/** Build force coefficients whose equilibrium ridge spacing is ~`spacing`
 *  domain units, by rescaling the paper baseline. */
export function coeffsForSpacing(spacing: number): ForceCoeffs {
  const lambda = spacing / BASE_SPACING;
  return {
    alpha: BASE_COEFFS.alpha / (lambda * lambda),
    beta: BASE_COEFFS.beta,
    gamma: BASE_COEFFS.gamma / lambda,
    eA: BASE_COEFFS.eA / lambda,
    eR: BASE_COEFFS.eR / lambda,
    chi: BASE_COEFFS.chi,
    cutoff: CUTOFF_SPACINGS * spacing,
  };
}

/** Repulsion kernel f_R(d) (positive). */
export function fR(d: number, c: ForceCoeffs): number {
  return (c.alpha * d * d + c.beta) * Math.exp(-c.eR * d);
}

/** Attraction kernel f_A(d) (negative). */
export function fA(d: number, c: ForceCoeffs): number {
  return -c.gamma * d * Math.exp(-c.eA * d);
}

/** Along-ridge coefficient f_s(d). */
export function fS(d: number, c: ForceCoeffs): number {
  return c.chi * fA(d, c) + fR(d, c);
}

/** Across-ridge coefficient f_l(d). */
export function fL(d: number, c: ForceCoeffs): number {
  return fA(d, c) + fR(d, c);
}
