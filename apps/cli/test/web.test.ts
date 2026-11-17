import { describe, expect, it } from "vitest";

import { UDEV_RULE } from "../src/udev";
import { opensBrowser, resolveAsset } from "../src/web";

const ROOT = "/opt/beastx/web";

describe("udev rule", () => {
  it("matches the Beast X 4K receiver by vendor and product id", () => {
    expect(UDEV_RULE).toContain('ATTRS{idVendor}=="36a7"');
    expect(UDEV_RULE).toContain('ATTRS{idProduct}=="a887"');
    expect(UDEV_RULE).toContain('TAG+="uaccess"');
  });
});

describe("browser opening", () => {
  it("opens the browser unless --no-open is passed", () => {
    expect(opensBrowser([])).toBeTruthy();
    expect(opensBrowser(["--port", "5174"])).toBeTruthy();
    expect(opensBrowser(["--no-open"])).toBeFalsy();
  });
});

describe("static asset paths", () => {
  it("maps a plain asset path under the root", () => {
    expect(resolveAsset(ROOT, "/assets/app.js")).toBe(`${ROOT}/assets/app.js`);
  });

  it("falls back to index.html for the root path", () => {
    expect(resolveAsset(ROOT, "/")).toBe(`${ROOT}/index.html`);
  });

  it("keeps parent-directory escapes under the root", () => {
    const resolved = resolveAsset(ROOT, "/../../etc/passwd");

    expect(resolved.startsWith(`${ROOT}/`)).toBeTruthy();
  });

  it("falls back to index.html for an encoded parent-directory escape", () => {
    expect(resolveAsset(ROOT, "/%2e%2e%2fsecret")).toBe(`${ROOT}/index.html`);
  });

  it("falls back to index.html for a malformed percent-encoding", () => {
    expect(resolveAsset(ROOT, "/%E0%A4%A")).toBe(`${ROOT}/index.html`);
  });
});
