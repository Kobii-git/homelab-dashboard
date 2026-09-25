import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudSun, X } from "lucide-react";
import type { DashboardUtilitiesSummaryDto } from "../../../shared/types";
import { useAnchoredPosition } from "../../components/useAnchoredPosition";
import { StatusIndicator } from "../../components/HealthStrip";
import { utilityPresentation } from "../../lib/healthPresentation";
import { CompactWeatherCard, WeatherIcon } from "../dashboard/DashboardLaunchpad";

type Props = { weather?: DashboardUtilitiesSummaryDto["weather"]; configured: boolean; error: string; onSettings: () => void };
export function HeaderWeather(props: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const data = props.configured ? props.weather?.data : null;
  const stale = Boolean(data && (props.weather?.stale || props.weather?.error || props.error));
  const state = utilityPresentation(props.configured ? props.weather : { state: "disabled", data: null, stale: false, error: null, fetchedAt: null }, props.configured ? props.error : "");
  const label = data ? `${Math.round(data.temperature)}${data.units === "metric" ? "°C" : "°F"} · ${data.condition}` : props.configured ? state.label : "Set weather";
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" className="hp-header-weather" aria-label={`Weather: ${label}${stale ? ", cached" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { trigger.current?.focus(); setOpen(!open); }}>
      {data ? <WeatherIcon code={data.weatherCode} isDay={data.isDay} size={17} /> : <CloudSun size={17} aria-hidden="true" />}
      <span>{label}</span>{stale && <small>Cached</small>}
    </button>
    {open && trigger.current && createPortal(<WeatherDisclosure {...props} id={id} anchor={trigger.current} onClose={close} />, document.body)}
  </>;
}

function WeatherDisclosure({ weather, configured, error, onSettings, id, anchor, onClose }: Props & { id: string; anchor: HTMLElement; onClose: (restore?: boolean) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(anchor, panel, false, true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    panel.current?.focus();
    const outside = (event: Event) => { if (event.target instanceof Node && !anchor.contains(event.target) && !panel.current?.contains(event.target)) onCloseRef.current(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", key); };
  }, [anchor]);
  const state = utilityPresentation(configured ? weather : { state: "disabled", data: null, stale: false, error: null, fetchedAt: null }, configured ? error : "");
  return <div ref={panel} id={id} className="hp-weather-popup" role="dialog" aria-label="Weather details" tabIndex={-1} style={position}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>("button, a[href]");
      if ((event.shiftKey && (event.target === panel.current || event.target === controls?.[0])) || (!event.shiftKey && event.target === controls?.[controls.length - 1])) onClose();
    }}>
    <div className="hp-card-title"><h3>Weather</h3><button type="button" aria-label="Close weather details" onClick={() => onClose()}><X size={16} /></button></div>
    {configured && weather?.data ? <CompactWeatherCard data={weather.data} stale={weather.stale || Boolean(weather.error) || Boolean(error)} /> : <StatusIndicator tone={state.tone}>{state.label}</StatusIndicator>}
    <button type="button" onClick={() => { onClose(); onSettings(); }}>Location &amp; units</button>
  </div>;
}
