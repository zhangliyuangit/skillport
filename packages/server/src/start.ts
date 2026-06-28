import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp, type ApiService } from "./app.js";

export interface RunningServer {
  host: "127.0.0.1";
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

export async function startServer(options: {
  service: ApiService;
  openBrowser?: (url: string) => Promise<void>;
}): Promise<RunningServer> {
  const host = "127.0.0.1" as const;
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const app = buildApp({
    service: options.service,
    token,
    origin: () => origin
  });
  await app.listen({ host, port: 0 });
  const address = app.server.address() as AddressInfo;
  origin = `http://${host}:${address.port}`;
  const url = `${origin}/#token=${token}`;
  await options.openBrowser?.(url);
  return {
    host,
    port: address.port,
    token,
    url,
    close: () => app.close()
  };
}
