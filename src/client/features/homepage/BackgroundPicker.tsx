import { useId } from "react";
import { builtInBackgrounds } from "../../../shared/backgrounds";
import type { HomepageSnapshot } from "../../../shared/homepage";
import { backgroundImage } from "./backgrounds";

export function BackgroundPicker({ value, assets, onChange }: {
  value: string;
  assets: HomepageSnapshot["assets"];
  onChange: (value: string) => void;
}) {
  const name = useId();
  const selected = builtInBackgrounds.find(item => item.id === value);
  return <section className="hp-background-picker" aria-label="Workspace background">
    <label className="hp-background-select">Background
      <select aria-label="Background" value={value} onChange={event => onChange(event.target.value)}>
        <option value="none">Plain</option>
        <option value="dawn">Dawn</option>
        <option value="ocean">Ocean</option>
        {builtInBackgrounds.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {assets.map((asset, index) => <option key={asset.id} value={`asset:${asset.id}`}>Uploaded background {index + 1}</option>)}
      </select>
    </label>
    <fieldset className="hp-background-options">
      <legend>Included backgrounds</legend>
      <div className="hp-background-grid">
        {builtInBackgrounds.map(item => <label key={item.id} className="hp-background-option">
          <input className="hp-sr-only" type="radio" name={name} value={item.id} checked={item.id === value}
            onChange={() => onChange(item.id)} aria-label={item.name} />
          <img src={item.src.replace(".jpg", "-thumb.jpg")} alt="" width={384} height={216} loading="lazy" decoding="async" />
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
        </label>)}
      </div>
    </fieldset>
    <div className={`hp-background-preview hp-bg-${value.split(":")[0]}`} style={{ backgroundImage: backgroundImage(value) }} aria-label="Background preview">
      <strong>{selected?.name ?? "Your workspace"}</strong>
      <span>A little room to focus.</span>
    </div>
    <p className="muted-copy">Preview for this workspace. Save layout applies your choice; Cancel preview keeps your current background.</p>
  </section>;
}
