import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  env: core.env ?? {},
  extends: [core, react, vitest, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/dist/**",
    ".agents/**",
    "scripts/oxlint-effect/**",
  ],
  jsPlugins: ["./scripts/oxlint-effect/index.mjs"],
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.spec.ts"],
      rules: {
        "effect-skill/effect-promise": "off",
        "effect-skill/expect-in-if": "error",
        "effect-skill/json-parse-defect": "off",
        "effect-skill/option-getorthrow": "off",
        "effect-skill/run-in-ui": "off",
        "effect-skill/throw-in-effect-gen": "off",
      },
    },
  ],
  rules: {
    "anti-slop/require-safety-comment-for-type-assertion": "off",
    "effect-skill/cast-requirements": "error",
    "effect-skill/catch-all-to-success": "error",
    "effect-skill/effect-in-plain-it": "error",
    "effect-skill/effect-promise": "error",
    "effect-skill/expect-in-if": "off",
    "effect-skill/fetch-without-signal": "error",
    "effect-skill/json-parse-defect": "error",
    "effect-skill/numeric-duration": "error",
    "effect-skill/option-getorthrow": "error",
    "effect-skill/point-free-foreach": "error",
    "effect-skill/process-exit": "error",
    "effect-skill/ref-get-then-set": "error",
    "effect-skill/run-in-ui": "error",
    "effect-skill/secret-config-not-redacted": "error",
    "effect-skill/swallow-cause": "error",
    "effect-skill/throw-in-effect-gen": "error",
  },
});
