# ridge-field-ts

Deterministic **synthetic-fingerprint** synthesis in TypeScript. Grows a genuine
friction-ridge print from a seed profile — pure TS, zero runtime dependencies,
no Svelte / three.js / app coupling. Every "random" quantity is derived from a
hash of the input, so a given profile always produces a byte-identical print
(`Math.random` is never used).

The print is not a wave field or a topo map. It is the stationary state of an
**anisotropic interaction model**: a cloud of particles (Merkel cells) relaxes
under a short-range-repulsion / long-range-attraction force, steered by an
orientation field, until the cells self-organize into equidistant ridge lines.
Minutiae (bifurcations, ridge endings) **emerge** from the relaxation; they are
never drawn in by hand.

Model: Düring, Gottschlich, Huckemann, Kreusser, Schönlieb, "An anisotropic
interaction model for simulating fingerprints", *J. Math. Biol.* 78 (2019),
2171–2206. [doi:10.1007/s00285-019-01338-3](https://doi.org/10.1007/s00285-019-01338-3)
(CC BY 4.0).

> **Sibling project:** [`ridge-field`](https://github.com/CameronWhiteside/ridge-field)
> is the Rust core of the same model — the flagship for batch synthesis (1M+
> prints) and a future WASM target. `ridge-field-ts` is the realtime,
> SSR-friendly TypeScript twin that powers [handprint.sh](https://handprint.sh).

## Install

```sh
npm i ridge-field-ts
# or, straight from git before the npm release:
npm i github:CameronWhiteside/ridge-field-ts
```

## API

```ts
import {
  deriveField,     // (profile) -> OrientationField
  simulate,        // (field, opts?) -> ParticleState
  extractRidges,   // (state, field, opts?) -> { ridges, minutiae }
  toSvgPaths,      // (ridges, view?) -> string[]
  synthesize,      // (profile, opts?) -> FingerprintPrint  (one-call convenience)
} from 'ridge-field-ts';

const print = synthesize(profile);
// print.svgPaths   -> SVG `d` strings, ready to render
// print.ridges     -> polylines in the unit domain
// print.minutiae   -> emergent endings + bifurcations
// print.patternClass, print.settleMs
```

`FingerprintProfile` is the only input shape:

```ts
interface FingerprintProfile {
  handle: string;
  vision: number; choice: number; method: number; // type-mix totals
  totalMarks: number;
  totalHandprints: number;
  topSubtypes: string[];
  handprints: Array<{
    sig: string; markCount: number; ts: string;   // ISO
    vision: number; choice: number; method: number;
  }>;
}
```

## The pipeline

### 1. `deriveField` — profile → orientation field

The global pattern is set by the **singularities** of the orientation field,
built with the Sherlock-Monro zero-pole model:

```
theta(z) = theta_bg(z) + 1/2 * [ SUM_deltas arg(z - delta_k) - SUM_cores arg(z - core_k) ]
s = (cos theta, sin theta)      // ridges run ALONG s
l = (-sin theta, cos theta)     // perpendicular
```

A core rotates the field by `-pi` as you circle it (a loop centre); a delta by
`+pi` (a triangular junction). A **pattern class** (arch / tented-arch / loop /
whorl / double-loop) is chosen from the seed and fixes a small template
singularity set; per-item detail lives in local perturbations, so adding or
removing one mark shifts local minutiae but preserves the global class — the
paper's identical-twins analogy (shared field, differing minutiae).

### 2. `simulate` — the relaxation

```
dx_j/dt = SUM over neighbors k of F(x_j - x_k),
F = f_s(|d|)(s.d)s + f_l(|d|)(l.d)l
```

with the Kücken-Champod kernels (`forces.ts`). A uniform spatial-bucket grid
(cell = force cutoff) keeps each step `O(N * localNeighbors)`. Explicit Euler,
small `dt`, a fixed iteration budget; particles stay inside the domain boundary.

### 3. `extractRidges` — settled cloud → continuous ridge polylines

The relaxation decides WHERE the ridges are; this step walks the local ridge
direction `s`, snapping laterally onto the settled density so a ridge rides real
particles rather than a bare field streamline. A ridge ends at an interior
**ending** or the boundary; **bifurcations** are interior termini abutting
another ridge.

### 4. `toSvgPaths` — ridges → SVG

Ridges map onto the view and smooth with a Catmull-Rom spline (cubic Béziers).
**Monochrome by design**: a fingerprint is ink on paper, so no per-ridge colour.

## Determinism

Everything is seeded from `fnv1a32` hashes via `mulberry32`. No `Math.random`,
no I/O, no wall-clock dependence (aside from the optional `settleMs` timing).
Identical profiles yield identical prints.

## License

MIT © Cameron Whiteside. Algorithm after Düring et al. (2019), used under CC BY 4.0.
