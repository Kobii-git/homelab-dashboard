import type { TagDto } from "../lib/api";

export function TagPicker({
  tags,
  type,
  name = "tagIds",
  defaultSelected = []
}: {
  tags: TagDto[];
  type: string;
  name?: string;
  defaultSelected?: string[];
}) {
  const filtered = tags.filter((tag) => tag.type === type || tag.type === "general");

  if (filtered.length === 0) {
    return <p className="muted-copy" style={{ margin: 0, fontSize: 12 }}>No tags yet - create them in Services &gt; Tags.</p>;
  }

  return (
    <div className="tag-picker">
      {filtered.map((tag) => (
        <label className="tag-chip-option" key={tag.id}>
          <input
            type="checkbox"
            name={name}
            value={tag.id}
            defaultChecked={defaultSelected.includes(tag.id)}
          />
          <span style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}>{tag.name}</span>
        </label>
      ))}
    </div>
  );
}

export function readTagIds(form: FormData, name = "tagIds"): string[] {
  return form.getAll(name).map(String).filter(Boolean);
}
