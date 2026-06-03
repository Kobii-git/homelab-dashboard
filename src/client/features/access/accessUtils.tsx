import { Monitor, TerminalSquare } from "lucide-react";

export type Protocol = "ssh" | "rdp";

export function ProtocolIcon({ protocol, size = 18 }: { protocol: Protocol; size?: number }) {
  return protocol === "ssh" ? <TerminalSquare size={size} /> : <Monitor size={size} />;
}

export function sessionStatusLabel(status: string): string {
  if (status === "launching") return "Connecting";
  if (status === "closed") return "Closed";
  if (status === "failed") return "Failed";
  return status;
}
