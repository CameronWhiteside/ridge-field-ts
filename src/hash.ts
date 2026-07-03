// Deterministic hashing + seeded PRNG. Math.random is BANNED anywhere in this
// library: every "random" quantity is derived from a hash of profile data so a
// given profile always yields a byte-identical print.

/** FNV-1a 32-bit hash of a string to a uint32. Stable across runs and hosts. */
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: pure, fast, deterministic from a uint32 seed. Returns a
 *  function that yields successive floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uint32 seed for a named sub-stream derived from a base seed. Lets one
 *  profile hash spawn several independent, still-deterministic streams. */
export function subSeed(base: number, label: string): number {
  return fnv1a32(`${base >>> 0}:${label}`);
}

/** Map a uint32 to a float in [0, 1). */
export function unitFloat(u: number): number {
  return (u >>> 0) / 4294967296;
}
