/**
 * Translate text into the X11 keysyms guacd expects, so arbitrary text can be
 * "typed" into a remote session (paste-as-keystrokes). This works for both SSH
 * terminals and RDP fields and does not depend on the browser clipboard API,
 * which is unavailable over plain HTTP.
 */

// Common non-printable keys.
export const KEYSYM = {
  backspace: 0xff08,
  tab: 0xff09,
  enter: 0xff0d,
  escape: 0xff1b,
  delete: 0xffff,
  ctrl: 0xffe3,
  alt: 0xffe9
} as const;

/**
 * Map a single character to its X11 keysym. Latin-1 characters map directly to
 * their code point; other Unicode characters use the 0x01000000 offset that
 * X11 (and guacd) use for direct Unicode input.
 */
export function charToKeysym(ch: string): number {
  if (ch === "\n" || ch === "\r") return KEYSYM.enter;
  if (ch === "\t") return KEYSYM.tab;
  if (ch === "\b") return KEYSYM.backspace;
  const codePoint = ch.codePointAt(0) ?? 0;
  return codePoint <= 0xff ? codePoint : 0x01000000 + codePoint;
}

/** Map a string to a list of keysyms, one per Unicode code point. */
export function textToKeysyms(text: string): number[] {
  return Array.from(text).map(charToKeysym);
}
