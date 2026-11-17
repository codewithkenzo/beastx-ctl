import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ".agents/**",
    "**/dist/**",
    "**/*.generated.*",
    "scripts/oxlint-effect/**",
    "docs/**",
    "refs/**",
    "device/**",
    ".tickets/**",
    "PROMPT.md",
  ],
});
