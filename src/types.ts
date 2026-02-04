export interface App {
  id: string;
  name: string;
  path: string;
  command: string;
  port: number | null;
  run_on_startup: boolean;
  created_at: string;
  subdomain: string | null;
}

export interface ProxyServiceStatus {
  installed: boolean;
  caddy_running: boolean;
}

export interface ProxyRoute {
  subdomain: string;
  port: number;
}

export interface RunningApps {
  [id: string]: number;
}

export interface AppUsage {
  cpu: number;
  memory: number;
}

export interface AppsUsage {
  [id: string]: AppUsage;
}

export interface LogEntry {
  type: "stdout" | "stderr";
  message: string;
}

export interface AppLogs {
  [id: string]: LogEntry[];
}
