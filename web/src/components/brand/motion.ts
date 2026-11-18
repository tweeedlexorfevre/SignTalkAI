/** True when the viewer asked the system for less motion. */
export function motionReduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
