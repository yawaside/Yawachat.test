#!/usr/bin/env node
// YawaMetrics widget validation (CI job "web", TECHNICAL_SPEC 8.3):
//   * artifact exists and stays within the size budget
//   * all 6 styles and 5 accents are implemented (FT-7.3, FT-7.4)
//   * every documented URL parameter is honoured
//   * the inline script parses as valid JavaScript
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const widgetPath = join(repoRoot, "native", "data", "widget.html");
const MAX_BYTES = 300 * 1024;

let failures = 0;
function fail(message) {
  console.error(`WIDGET CHECK FAILED: ${message}`);
  failures += 1;
}

const html = readFileSync(widgetPath, "utf8");
const size = statSync(widgetPath).size;
console.log(`widget.html: ${(size / 1024).toFixed(1)} KiB`);

if (size > MAX_BYTES) fail(`widget.html exceeds the ${MAX_BYTES / 1024} KiB budget`);

// Styles and accents (FT-7.3, FT-7.4)
const styles = ["panel", "stack", "badge", "cards", "minimal", "ticker"];
const accents = ["violet", "emerald", "sunset", "ice", "mono"];
for (const style of styles) {
  if (!html.includes(`"${style}"`)) fail(`style "${style}" is missing`);
}
for (const accent of accents) {
  if (!html.includes(`${accent}:`)) fail(`accent "${accent}" is missing`);
}

// URL parameters (FT-7.10)
const params = [
  "style", "accent", "bg", "radius", "scale", "blur",
  "tiles", "total", "names", "title", "anim",
  "interval", "demo", "lang", "config",
];
for (const param of params) {
  if (!html.includes(param)) fail(`URL parameter "${param}" is not referenced`);
}

// Inline script must be syntactically valid JavaScript.
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  fail("no inline <script> found");
} else {
  try {
    new vm.Script(scriptMatch[1], { filename: "widget.html<script>" });
  } catch (error) {
    fail(`inline script has a syntax error: ${error.message}`);
  }
}

// A self-contained overlay must not reference external resources (FT-7.1).
const externalRefs = html.match(/(src|href)\s*=\s*["']https?:\/\//gi) || [];
if (externalRefs.length > 0) fail(`external resource references found: ${externalRefs.join(", ")}`);

if (failures > 0) {
  process.exit(1);
}
console.log("Widget check passed.");
