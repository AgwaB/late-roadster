/**
 * Hints and tips name keyboard keys; on a touch screen they name the on-screen buttons instead (SPACE -> JUMP,
 * SHIFT -> BOOST, E -> STICK).
 */
export function forInput(text: string, touch: boolean): string {
  if (!touch) return text;
  return text
    .replace(/\bSPACE\b/g, "JUMP")
    .replace(/\bSHIFT\b/g, "BOOST")
    .replace(/\bE\b/g, "STICK");
}
