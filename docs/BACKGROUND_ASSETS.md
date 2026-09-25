# Built-in background artwork

Tidal, Aurora, Blue hour, and Graphite were generated for this project on 2026-09-25
using OpenAI's built-in image generation tool. No reference photos or third-party
logos were supplied. These are generated artwork, not photographs of specific places.

The final app assets live in `public/backgrounds/`: `tidal-v1.jpg`, `aurora-v1.jpg`,
`blue-hour-v1.jpg`, and `graphite-v1.jpg`, with matching `-thumb.jpg` picker previews.
Original artwork is 1672 × 941 pixels. JPEG encoding at quality 85 preserves the
composition; 384-pixel thumbnails use quality 80. Only the selected full-size
background is used on the homepage. Images are served locally with no animation,
video, canvas renderer, or external image request. Theme-aware shading keeps text legible.

The `wallpaper:` IDs are permanent configuration values. Filename version suffixes
allow a future artwork revision without stale cached files. Built-ins are supplied
by the application build; uploaded backgrounds retain their existing database storage.

## Generation prompts

### 1. Tidal — soft teal gradients

Use case: stylized-concept. Asset type: standalone background wallpaper for a private homelab dashboard. Generate one landscape 16:9 image, ideally 2560x1440. This is ONLY the wallpaper, not an app screenshot or mockup. It will sit behind white text, small teal icons and transparent UI sections spread across the full width. Keep the entire image dark, soft and low contrast, with spacious quiet negative space throughout. Full bleed edge to edge, suitable for cropping at desktop and phone sizes. No text, typography, logos, icons, interface, cards, frames, borders, people, or watermark. Avoid bright white spots, busy fine detail, stars, checkerboards, luminous neon lines and banding. This is a static bitmap, any softness and lighting must be baked into the image. Primary request: a sophisticated abstract color-field wallpaper with broad softly blended pools of muted petrol teal, deep midnight navy and smoky slate. Gentle silky flowing forms with almost imperceptible transitions, a very faint cool cyan glow near the upper left edge balanced with deeper blue toward the lower right. Most of the scene stays around dark navy #17232f; teal is subdued, never luminous. Organic and refined, no distinct ribbons or objects, no visual focal point. Contemporary desktop wallpaper, restful, airy despite being dark.

### 2. Aurora — a quiet ribbon of color

Use case: stylized-concept. Asset type: standalone background wallpaper for a private homelab dashboard. Generate one landscape 16:9 image, ideally 2560x1440. This is ONLY the wallpaper, not an app screenshot or mockup. It will sit behind white text, small teal icons and transparent UI sections spread across the full width. Keep the entire image dark, soft and low contrast, with spacious quiet negative space throughout. Full bleed edge to edge, suitable for cropping at desktop and phone sizes. No text, typography, logos, icons, interface, cards, frames, borders, people, or watermark. Avoid bright white spots, busy fine detail, stars, checkerboards, luminous neon lines and banding. This is a static bitmap, any softness and lighting must be baked into the image. Primary request: an elegant abstract aurora in deep navy darkness. One very broad diaphanous atmospheric ribbon of muted sea green fading into desaturated indigo gently curves across the upper quarter and outer edges; most of the center and lower area is calm blue-black. More like colored mist or long-exposure silk than a neon aurora; dim, subtle, softly blurred at source, no sharp bright ridges, no particles, no stars. A faint violet hint at the far right is allowed, very restrained. Premium photographic atmosphere, continuous edge-to-edge color.

### 3. Blue hour — minimal misty landscape

Use case: stylized-concept. Asset type: standalone background wallpaper for a private homelab dashboard. Generate one landscape 16:9 image, ideally 2560x1440. This is ONLY the wallpaper, not an app screenshot or mockup. It will sit behind white text, small teal icons and transparent UI sections spread across the full width. Keep the entire image dark, soft and low contrast, with spacious quiet negative space throughout. Full bleed edge to edge, suitable for cropping at desktop and phone sizes. No text, typography, logos, icons, interface, cards, frames, borders, people, or watermark. Avoid bright white spots, busy fine detail, stars, checkerboards, luminous neon lines and banding. This is a static bitmap, any softness and lighting must be baked into the image. Primary request: a tranquil near-photographic minimalist landscape at blue hour, looking across broad dark water into a few distant layers of misty mountain silhouettes. The distant ridge sits in the bottom third and the sky occupies the upper two thirds; landscape elements have barely visible tonal differences, no discernible sun or moon. Muted deep blue-gray sky, dusky teal haze at the horizon, dark ink water, subtle broad reflection with almost no ripples. No buildings, trees, landmarks, foreground objects, or bright horizon streak. Quiet editorial landscape, looks photographic and spacious, a soft natural alternative to abstract gradients.

### 4. Graphite — subtle material and warm light

Use case: stylized-concept. Asset type: standalone background wallpaper for a private homelab dashboard. Generate one landscape 16:9 image, ideally 2560x1440. This is ONLY the wallpaper, not an app screenshot or mockup. It will sit behind white text, small teal icons and transparent UI sections spread across the full width. Keep the entire image dark, soft and low contrast, with spacious quiet negative space throughout. Full bleed edge to edge, suitable for cropping at desktop and phone sizes. No text, typography, logos, icons, interface, cards, frames, borders, people, or watermark. Avoid bright white spots, busy fine detail, stars, checkerboards, luminous neon lines and banding. This is a static bitmap, any softness and lighting must be baked into the image. Primary request: a refined abstract macro surface of matte charcoal and midnight blue, like softly sculpted mineral paper or brushed slate with extremely delicate broad contours. A dim desaturated copper-warm edge light enters from the far upper right, fading softly into cool charcoal; the rest is calm graphite and navy. Almost invisible fine natural grain, no repeating pattern, no cracks, no speckles, no glossy reflections. Broad sculptural folds are barely perceptible and flow diagonally near the edges while the full center remains uniformly dark and legible. Tactile, architectural, sophisticated, understated.
