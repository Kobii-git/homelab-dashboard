export const BACKUP_FORMAT_VERSION = "1.0.0";

export type BackupPayload = {
  version: string;
  exportedAt: string;
  folders: BackupFolder[];
  tags: BackupTag[];
  groups: BackupGroup[];
  resources: BackupResource[];
  credentials: BackupCredential[];
  connections: BackupConnection[];
  checks: BackupCheck[];
  notes: BackupNote[];
  alertChannels: BackupAlertChannel[];
  alertRules: BackupAlertRule[];
  maintenanceWindows: BackupMaintenanceWindow[];
  widgets: BackupWidget[];
};

export type BackupFolder = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  sortOrder: number;
};

export type BackupTag = {
  id: string;
  name: string;
  color: string | null;
  type: string;
};

export type BackupGroup = {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
};

export type BackupResource = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  host: string | null;
  notes: string | null;
  favorite: boolean;
  sortOrder: number;
  groupId: string | null;
  tagIds: string[];
};

export type BackupCredential = {
  id: string;
  label: string;
  username: string | null;
  notes: string | null;
  folderId: string | null;
  encryptedBlob: string;
  iv: string;
  authTag: string;
  tagIds: string[];
};

export type BackupConnection = {
  id: string;
  resourceId: string;
  type: string;
  name: string | null;
  host: string;
  port: number;
  usernameHint: string | null;
  credentialId: string | null;
  notes: string | null;
  favorite: boolean;
  folderId: string | null;
  sortOrder: number;
  tagIds: string[];
};

export type BackupCheck = {
  id: string;
  resourceId: string;
  type: string;
  target: string;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
};

export type BackupNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  resourceId: string | null;
};

export type BackupAlertChannel = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  configSummaryJson: string;
  encryptedConfigBlob: string;
  iv: string;
  authTag: string;
};

export type BackupAlertRule = {
  id: string;
  name: string;
  channelId: string;
  event: string;
  enabled: boolean;
  cooldownSeconds: number;
};

export type BackupMaintenanceWindow = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  scopeJson: string;
  notes: string | null;
};

export type BackupWidget = {
  id: string;
  type: string;
  title: string;
  configJson: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
  enabled: boolean;
};

export type ImportPreview = {
  valid: boolean;
  version: string;
  exportedAt: string | null;
  counts: Record<string, number>;
  warnings: string[];
  errors: string[];
};

export type ImportResult = ImportPreview & {
  applied: boolean;
  mode: "merge" | "replace";
  created: Record<string, number>;
  skipped: Record<string, number>;
};
