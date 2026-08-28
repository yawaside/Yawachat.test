#!/usr/bin/env node
// YawaMetrics — single source of version: the first "## X.Y.Z" entry of
// CHANGELOG.md (TECHNICAL_SPEC section 10).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const changelogPath = join(repoRoot, "CHANGELOG.md");

const changelog = readFileSync(changelogPath, "utf8");
const match = changelog.match(/^##\s+(\d+)\.(\d+)\.(\d+)\s*$/m);

if (!match) {
  console.error(`No "## X.Y.Z" entry found in ${changelogPath}`);
  process.exit(1);
}

const version = `${match[1]}.${match[2]}.${match[3]}`;
process.stdout.write(version);
