import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Console, Context, Effect, Layer, Option } from "effect";

import { IoError, describeError, nodeFault } from "./errors";
import type { NodeFault } from "./errors";

const PORT_FLAG = "--port";
const NO_OPEN_FLAG = "--no-open";
const DEFAULT_PORT = 5174;
const HOST = "127.0.0.1";
const INDEX = "index.html";
const BASE_URL = "http://localhost";

const MISSING_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "EISDIR",
  "ENOTDIR",
]);

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const OPENERS: ReadonlyMap<string, string> = new Map([
  ["darwin", "open"],
  ["linux", "xdg-open"],
]);

const WEB_ROOT = fileURLToPath(new URL("web/", import.meta.url));

export interface WebAssetsApi {
  readonly read: (
    path: string
  ) => Effect.Effect<Option.Option<Uint8Array>, IoError>;
}

export class WebAssets extends Context.Service<WebAssets, WebAssetsApi>()(
  "beastx/WebAssets"
) {}

const isMissing = (fault: NodeFault): boolean =>
  Option.exists(fault.code, (code) => MISSING_CODES.has(code));

const recoverRead =
  (filePath: string) =>
  (error: NodeFault): Effect.Effect<Option.Option<never>, IoError> =>
    isMissing(error)
      ? Effect.succeedNone
      : Effect.fail(new IoError({ path: filePath, reason: error.reason }));

const readAsset = (filePath: string) =>
  Effect.tryPromise({
    catch: (cause) => nodeFault(cause),
    try: () => readFile(filePath),
  }).pipe(Effect.asSome, Effect.catch(recoverRead(filePath)));

export const webAssetsLayer = Layer.succeed(WebAssets)({ read: readAsset });

const pathOf = Option.liftThrowable(
  (target: string) => new URL(target, BASE_URL).pathname
);

const decodePath = Option.liftThrowable(decodeURIComponent);

const isInside = (root: string, filePath: string): boolean => {
  const rel = path.relative(root, filePath);

  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
};

export const resolveAsset = (root: string, target: string): string => {
  const index = path.join(root, INDEX);
  const decoded = Option.flatMap(pathOf(target), decodePath);

  if (Option.isNone(decoded)) {
    return index;
  }

  const candidate = path.resolve(root, `.${decoded.value}`);

  return isInside(root, candidate) ? candidate : index;
};

const contentType = (filePath: string): string =>
  CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";

interface Served {
  readonly body: Uint8Array;
  readonly status: number;
  readonly type: string;
}

const text = (status: number, message: string): Served => ({
  body: new TextEncoder().encode(message),
  status,
  type: "text/plain; charset=utf-8",
});

const serveAsset = Effect.fn("web.serveAsset")(function* serveAsset(
  assets: WebAssetsApi,
  root: string,
  target: string
): Effect.fn.Return<Served, IoError> {
  const requested = resolveAsset(root, target);
  const direct = yield* assets.read(requested);

  if (Option.isSome(direct)) {
    return { body: direct.value, status: 200, type: contentType(requested) };
  }

  const index = path.join(root, INDEX);
  const page = yield* assets.read(index);

  if (Option.isNone(page)) {
    return text(404, "beastx: web app not found");
  }

  return { body: page.value, status: 200, type: contentType(index) };
});

const reportRespondError = (error: IoError) =>
  Console.error(`beastx: ${describeError(error)}`).pipe(
    Effect.map(() => text(500, "beastx: internal error"))
  );

const respond = (
  assets: WebAssetsApi,
  root: string,
  target: string
): Effect.Effect<Served> =>
  serveAsset(assets, root, target).pipe(Effect.catch(reportRespondError));

const send = (res: ServerResponse, served: Served) =>
  Effect.sync(() => {
    res.writeHead(served.status, { "content-type": served.type });
    res.end(served.body);
  });

const listen = (server: Server, port: number) =>
  Effect.callback<undefined, IoError>((resume) => {
    const fail = (cause: unknown) =>
      resume(
        Effect.fail(
          new IoError({ path: `port ${port}`, reason: nodeFault(cause).reason })
        )
      );

    server.once("error", fail);
    server.listen(port, HOST, () => {
      server.off("error", fail);
      resume(Effect.succeed(undefined));
    });
  });

const closeServer = (server: Server) =>
  Effect.callback<undefined>((resume) => {
    server.closeAllConnections();
    server.close(() => resume(Effect.succeed(undefined)));
  });

const openServer = (assets: WebAssetsApi, root: string, port: number) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      createServer((req, res) => {
        void Effect.runPromise(
          respond(assets, root, req.url ?? "/").pipe(
            Effect.flatMap((served) => send(res, served))
          )
        );
      })
    ).pipe(Effect.tap((server) => listen(server, port))),
    closeServer
  );

const openBrowser = (url: string) =>
  Effect.callback<undefined>((resume) => {
    const opener = OPENERS.get(process.platform);

    if (opener === undefined) {
      resume(Effect.succeed(undefined));

      return;
    }

    const child = spawn(opener, [url], { detached: true, stdio: "ignore" });

    child.once("error", () => resume(Effect.succeed(undefined)));
    child.once("spawn", () => {
      child.unref();
      resume(Effect.succeed(undefined));
    });
  });

export const parsePort = (args: readonly string[]): Option.Option<number> => {
  const flag = args.indexOf(PORT_FLAG);

  if (flag === -1) {
    return Option.some(DEFAULT_PORT);
  }

  const port = Number(args[flag + 1]);

  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? Option.some(port)
    : Option.none();
};

export const opensBrowser = (args: readonly string[]): boolean =>
  !args.includes(NO_OPEN_FLAG);

export const serveWeb = (port: number, open: boolean) =>
  Effect.scoped(
    Effect.gen(function* serveWebApp() {
      const assets = yield* WebAssets;
      const url = `http://${HOST}:${port}/`;

      yield* openServer(assets, WEB_ROOT, port);
      yield* Console.log(`beastx web: ${url}`);
      yield* Console.log(
        "WebHID works in Chrome, Edge, Brave and Helium only."
      );

      if (open) {
        yield* openBrowser(url);
      }

      return yield* Effect.never;
    })
  );
