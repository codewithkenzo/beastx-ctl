import { Effect, Layer, Option } from "effect";

import { describeError } from "./errors";
import type { StatusError } from "./errors";
import { hidrawLayer } from "./hidraw";
import { readStatus, toModuleLine } from "./status";
import { sysfsLayer } from "./sysfs";
import { udevCommand } from "./udev";
import { watchLines } from "./watch";
import { opensBrowser, parsePort, serveWeb, webAssetsLayer } from "./web";

const STATUS = "status";
const WATCH = "watch";
const UDEV = "udev";
const WEB = "web";
const layer = Layer.mergeAll(sysfsLayer, hidrawLayer);

const printLine = (line: string) =>
  Effect.sync(() => {
    process.stdout.write(`${line}\n`);
  });

const failWith = (message: string, code: number) =>
  Effect.sync(() => {
    process.stderr.write(`${message}\n`);
    process.exitCode = code;
  });

const reportFailure = (error: StatusError) =>
  failWith(`beastx: ${describeError(error)}`, 1);

const statusLine = readStatus().pipe(
  Effect.map((reading) => JSON.stringify(toModuleLine(reading))),
  Effect.flatMap(printLine),
  Effect.catch(reportFailure),
  Effect.provide(layer)
);

const watchCommand = watchLines().pipe(Effect.provide(layer));

const webCommand = (args: readonly string[]) =>
  Option.match(parsePort(args), {
    onNone: () => failWith("usage: beastx web [--port 1-65535] [--no-open]", 2),
    onSome: (port) =>
      serveWeb(port, opensBrowser(args)).pipe(
        Effect.provide(webAssetsLayer),
        Effect.catch(reportFailure)
      ),
  });

const selectCommand = (name: string | undefined, args: readonly string[]) => {
  if (name === STATUS) {
    return statusLine;
  }

  if (name === WATCH) {
    return watchCommand;
  }

  if (name === UDEV) {
    return udevCommand;
  }

  if (name === undefined) {
    return webCommand([]);
  }

  if (name === WEB) {
    return webCommand(args);
  }

  return failWith(`usage: beastx ${STATUS} | ${WATCH} | ${UDEV} | ${WEB}`, 2);
};

await Effect.runPromise(selectCommand(process.argv[2], process.argv.slice(3)));
