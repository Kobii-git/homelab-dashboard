import { useEffect, useMemo, useState } from "react";
import type { DashboardResource } from "../../shared/types";

/** Remembers which image URLs already failed so polling re-renders don't flash retries. */
const sourceHealth = new Map<string, "ok" | "bad">();

export function iconSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function candidatesFor(resource: { id?: string }): string[] {
  if (!resource.id) return [];
  const source = `/api/resources/${encodeURIComponent(resource.id)}/icon`;
  return sourceHealth.get(source) === "bad" ? [] : [source];
}

export function ServiceIcon({
  resource,
  size = 40
}: {
  resource: Pick<DashboardResource, "name" | "icon" | "url" | "color"> & { id?: string };
  size?: number;
}) {
  const candidates = useMemo(
    () => candidatesFor(resource),
    [resource.id, resource.name, resource.icon, resource.url]
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [candidates]);

  const source = candidates[index];
  const color = resource.color ?? "#2dd4bf";

  if (!source) {
    return (
      <span
        className="svc-avatar"
        style={{
          width: size,
          height: size,
          color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
          fontSize: Math.max(11, Math.round(size * 0.34))
        }}
        aria-hidden
      >
        {initialsFor(resource.name)}
      </span>
    );
  }

  return (
    <img
      className="svc-img"
      src={source}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onLoad={() => sourceHealth.set(source, "ok")}
      onError={() => {
        sourceHealth.set(source, "bad");
        setIndex((current) => current + 1);
      }}
    />
  );
}
