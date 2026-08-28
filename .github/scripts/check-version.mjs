#!/usr/bin/env node
// YawaMetrics — version consistency check (TECHNICAL_SPEC section 10).
// The version must match in 7 files:
//   CHANGELOG.md, CMakeLists.txt, native/CMakeLists.txt,
//   buildspec.json, native/buildspec.json,
//   installer/YawaMetrics.iss, README.md (badge).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failures = 0;

function fail(message) {
  console.error(`VERSION MISMATCH: ${message}`);
  failures += 1;
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

// --- Source of truth: CHANGELOG.md -----------------------------------------
const changelog = read("CHANGELOG.md");
const changelogMatch = changelog.match(/^##\s+(\d+\.\d+\.\d+)\s*$/m);
if (!changelogMatch) {
  console.error('CHANGELOG.md does not contain a "## X.Y.Z" heading');
  process.exit(1);
}
const expected = changelogMatch[1];
console.log(`Expected version (CHANGELOG.md): ${expected}`);

// --- CMakeLists.txt ----------------------------------------------------------
const rootCmake = read("CMakeLists.txt");
const rootCmakeMatch = rootCmake.match(/project\(YawaMetrics\s+VERSION\s+(\d+\.\d+\.\d+)/);
if (!rootCmakeMatch) fail("CMakeLists.txt: no project(YawaMetrics VERSION X.Y.Z)");
else if (rootCmakeMatch[1] !== expected) fail(`CMakeLists.txt: ${rootCmakeMatch[1]} != ${expected}`);

// --- native/CMakeLists.txt ---------------------------------------------------
const nativeCmake = read("native/CMakeLists.txt");
const nativeCmakeMatch = nativeCmake.match(/YAWAMETRICS_DEFAULT_VERSION\s+"(\d+\.\d+\.\d+)"/);
if (!nativeCmakeMatch) fail('native/CMakeLists.txt: no YAWAMETRICS_DEFAULT_VERSION "X.Y.Z"');
else if (nativeCmakeMatch[1] !== expected) fail(`native/CMakeLists.txt: ${nativeCmakeMatch[1]} != ${expected}`);

// --- buildspec.json ----------------------------------------------------------
for (const specPath of ["buildspec.json", "native/buildspec.json"]) {
  let spec;
  try {
    spec = JSON.parse(read(specPath));
  } catch (error) {
    fail(`${specPath}: not valid JSON (${error.message})`);
    continue;
  }
  if (spec.version !== expected) fail(`${specPath}: ${spec.version} != ${expected}`);
}

// --- installer/YawaMetrics.iss ------------------------------------------------
const iss = read("installer/YawaMetrics.iss");
const issMatch = iss.match(/#define\s+MyAppVersion\s+"(\d+\.\d+\.\d+)"/);
if (!issMatch) fail('installer/YawaMetrics.iss: no #define MyAppVersion "X.Y.Z"');
else if (issMatch[1] !== expected) fail(`installer/YawaMetrics.iss: ${issMatch[1]} != ${expected}`);

// --- README.md badge ------------------------------------------------------------
const readme = read("README.md");
const badgeMatch = readme.match(/version-(\d+\.\d+\.\d+)-/);
if (!badgeMatch) fail("README.md: no version badge (version-X.Y.Z-...)");
else if (badgeMatch[1] !== expected) fail(`README.md badge: ${badgeMatch[1]} != ${expected}`);

// --- Result ---------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} file(s) out of sync with CHANGELOG.md (${expected}).`);
  process.exit(1);
}
console.log(`Version ${expected} is consistent across all 7 files.`);
