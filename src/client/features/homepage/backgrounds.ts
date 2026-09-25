import { builtInBackgrounds } from "../../../shared/backgrounds";

export function backgroundImage(background: string): string | undefined {
  const preset = builtInBackgrounds.find(item => item.id === background);
  if (preset) return `linear-gradient(var(--hp-wallpaper-overlay),var(--hp-wallpaper-overlay)),url("${preset.src}")`;
  if (/^asset:[a-f0-9]{64}$/.test(background)) {
    return `linear-gradient(var(--hp-overlay),var(--hp-overlay)),url(/api/homepage/assets/${background.slice(6)})`;
  }
  return undefined;
}
