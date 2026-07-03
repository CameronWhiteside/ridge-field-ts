// Synthetic fingerprint library. Framework-agnostic, pure TypeScript: no Svelte,
// no three.js, no app imports. Grows a genuine particle-based fingerprint from a
// profile by relaxing an anisotropic interaction model (Düring et al. 2019) on
// an orientation field keyed to the profile's handprints. See README.md.
//
//   deriveField(profile)          -> OrientationField
//   simulate(field, opts)         -> ParticleState
//   extractRidges(state, field)   -> { ridges, minutiae }
//   toSvgPaths(ridges, view)      -> string[]
//   synthesize(profile, opts)     -> FingerprintPrint  (one-call convenience)

export type {
  Vec2,
  PatternClass,
  Singularity,
  OrientationField,
  Particle,
  ParticleState,
  Minutia,
  Ridge,
  FingerprintHandprint,
  FingerprintProfile,
  FingerprintPrint,
} from './types';

export { deriveField, profileHash, choosePatternClass, ridgeSpacingFor, particleCountFor } from './field';
export { simulate, isSettled, type SimulateOptions } from './simulate';
export { extractRidges, type ExtractOptions } from './ridges';
export { toSvgPaths, viewOfWidth, DEFAULT_VIEW, type SvgView } from './svg';
export { synthesize, type SynthesizeOptions } from './synthesize';
export { FINGERTIP, isInside, boundaryValue, type Boundary } from './boundary';
export {
  coeffsForSpacing,
  fR,
  fA,
  fS,
  fL,
  BASE_COEFFS,
  BASE_SPACING,
  type ForceCoeffs,
} from './forces';
export { fnv1a32, mulberry32 } from './hash';
