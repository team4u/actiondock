export interface ServerOptions {
  port?: number;
  host?: string;
  token?: string;
  projectRoot?: string;
  customHome?: string;
}

export interface ActionDockServerInstance {
  port: number;
  host: string;
  url: string;
  stop: () => Promise<void> | void;
}
