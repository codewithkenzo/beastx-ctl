import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const EMITTER =
  process.env.UI_TOKENS ??
  path.join(homedir(), ".agents/skills/ui-tokens/scripts/tokens.mjs");

const ROOT = path.join(import.meta.dir, "../../..");
const OUT = path.join(import.meta.dir, "../src/tokens.generated.css");
const BASE = "gao-ji-gan";
const THEMES = ["flexoki", "everforest"] as const;
const DECLARATION = /^(?<name>[\w-]+):\s*(?<value>.+);$/u;

const emit = (id: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), `tokens-${id}-`));

  const run = Bun.spawnSync([
    "bun",
    EMITTER,
    "emit",
    path.join(ROOT, "tokens", `${id}.json`),
    "--out",
    dir,
  ]);

  if (run.exitCode !== 0) {
    throw new Error(`emit ${id}: ${run.stderr.toString()}`);
  }

  return readFileSync(path.join(dir, "tokens.generated.css"), "utf-8");
};

const block = (css: string, selector: string): string => {
  const start = css.indexOf(`\n${selector} {\n`);

  if (start === -1) {
    throw new Error(`no ${selector} block`);
  }

  const end = css.indexOf("\n}\n", start + 1);

  return css.slice(start + selector.length + 4, end);
};

const declarations = (body: string): Map<string, string> =>
  new Map(
    body
      .split("\n")
      .map((line) => DECLARATION.exec(line.trim())?.groups)
      .filter((groups) => groups !== undefined)
      .map((groups) => [groups.name ?? "", groups.value ?? ""])
  );

const rule = (selector: string, lines: [string, string][]): string =>
  `${selector} {\n${lines.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n`;

const base = emit(BASE);
const baseRoot = declarations(block(base, ":root"));
const modeNames = new Set(declarations(block(base, ".dark")).keys());

const themed = THEMES.map((id) => {
  const css = emit(id);
  const root = declarations(block(css, ":root"));

  for (const [name, value] of root) {
    if (!modeNames.has(name) && baseRoot.get(name) !== value) {
      throw new Error(
        `${id}: ${name} differs from ${BASE}; only colour roles may change per theme`
      );
    }
  }

  const light = [...root].filter(([name]) => modeNames.has(name));
  const dark = [...declarations(block(css, ".dark"))];

  return [
    rule(`.palette-${id}`, light),
    rule(`.palette-${id}.dark`, dark),
  ].join("\n");
});

writeFileSync(OUT, `${base.trimEnd()}\n\n${themed.join("\n")}`);

console.log(
  `wrote ${OUT}: ${BASE} base, ${THEMES.join(", ")} as palette classes`
);
