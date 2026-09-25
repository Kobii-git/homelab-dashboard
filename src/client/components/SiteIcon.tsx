import { useState } from "react";

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function bookmarkLogo(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(host)) return "/logos/chatgpt.png";
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return "/logos/youtube.png";
  } catch { /* Invalid or missing destinations use initials. */ }
  return undefined;
}

export function IconFrame({ name, src, size = 40, onError }: {
  name: string; src?: string; size?: number; onError?: () => void;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const showImage = src && failedSource !== src;
  return <span className={`site-icon ${showImage ? "svc-img" : "svc-avatar"}`}
    style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * .34)) }} aria-hidden="true">
    {showImage ? <img src={src} alt="" width={size} height={size} loading="lazy"
      onError={() => { setFailedSource(src); onError?.(); }} /> : initialsFor(name)}
  </span>;
}

export function SiteIcon({ name, url, size = 40 }: { name: string; url: string; size?: number }) {
  return <IconFrame name={name} src={bookmarkLogo(url)} size={size} />;
}
