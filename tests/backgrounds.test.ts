import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtInBackgrounds } from "../src/shared/backgrounds";
import { defaultLayout, layoutSchema } from "../src/shared/homepage";
import { backgroundImage } from "../src/client/features/homepage/backgrounds";

describe("bundled workspace backgrounds", () => {
  it("accepts only named presets, preserves existing backgrounds, and keeps retired Aurora separate", () => {
    for (const value of [...builtInBackgrounds.map(item => item.id), "none", "dawn", "ocean", `asset:${"a".repeat(64)}`]) {
      expect(layoutSchema.parse({ ...defaultLayout(false), background: value }).background).toBe(value);
    }
    for (const value of ["aurora", "sunset"]) expect(layoutSchema.parse({ ...defaultLayout(false), background: value }).background).toBe("none");
    for (const value of ["wallpaper:missing", "wallpaper:../../private", "https://example.com/image.jpg", 'asset:bad") { color:red; }']) {
      expect(layoutSchema.safeParse({ ...defaultLayout(false), background: value }).success).toBe(false);
      expect(backgroundImage(value)).toBeUndefined();
    }
  });
  it("ships bounded local images and small picker thumbnails", () => {
    for (const preset of builtInBackgrounds) {
      expect(backgroundImage(preset.id)).toContain(`url("${preset.src}")`);
      const fullSize = statSync(`public${preset.src}`).size;
      const thumbnailSize = statSync(`public${preset.src.replace(".jpg", "-thumb.jpg")}`).size;
      expect(fullSize).toBeGreaterThan(1000);
      expect(fullSize).toBeLessThan(300 * 1024);
      expect(thumbnailSize).toBeGreaterThan(100);
      expect(thumbnailSize).toBeLessThan(20 * 1024);
    }
  });
});
