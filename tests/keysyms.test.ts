import { describe, expect, it } from "vitest";
import { KEYSYM, charToKeysym, textToKeysyms } from "../src/client/lib/keysyms.js";

describe("keysym mapping", () => {
  it("maps printable ASCII to its code point", () => {
    expect(charToKeysym("A")).toBe(0x41);
    expect(charToKeysym("b")).toBe(0x62);
    expect(charToKeysym("1")).toBe(0x31);
    expect(charToKeysym(" ")).toBe(0x20);
    expect(charToKeysym("/")).toBe(0x2f);
  });

  it("maps control characters to named keysyms", () => {
    expect(charToKeysym("\n")).toBe(KEYSYM.enter);
    expect(charToKeysym("\r")).toBe(KEYSYM.enter);
    expect(charToKeysym("\t")).toBe(KEYSYM.tab);
    expect(charToKeysym("\b")).toBe(KEYSYM.backspace);
  });

  it("maps non-Latin-1 Unicode with the 0x01000000 offset", () => {
    // Euro sign U+20AC
    expect(charToKeysym("€")).toBe(0x01000000 + 0x20ac);
  });

  it("translates a full string in order", () => {
    expect(textToKeysyms("Ab1\n")).toEqual([0x41, 0x62, 0x31, KEYSYM.enter]);
  });

  it("handles surrogate-pair emoji as a single code point", () => {
    // 😀 is U+1F600 (a surrogate pair in UTF-16) — must yield ONE keysym.
    expect(textToKeysyms("😀")).toEqual([0x01000000 + 0x1f600]);
  });
});
