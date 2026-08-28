#!/usr/bin/env python3
"""YawaMetrics CMake lint (TECHNICAL_SPEC 8.4).

Catches:
  * array indexing inside substitutions: ${VAR[0]}  (OR-6 — syntax error in CMake;
    list(GET VAR 0 out) must be used instead)
  * unbalanced parentheses and braces in CMake files
  * unbalanced double quotes (including multi-line strings awareness)
  * invalid CMakePresets.json / missing windows-ci-x64 presets
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INDEXING_RE = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*\[[^\]]*\]\}")
EXCLUDED_DIRS = {".deps", ".build", "build", "node_modules", ".git"}

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)
    print(f"LINT FAIL: {message}")


def find_cmake_files() -> list[Path]:
    files: list[Path] = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        if path.name == "CMakeLists.txt" or path.suffix == ".cmake":
            files.append(path)
    return sorted(files)


def strip_comments(text: str) -> str:
    # Strip bracket comments #[[ ... ]] first, then line comments.
    text = re.sub(r"#\[\[.*?\]\]", "", text, flags=re.S)
    return re.sub(r"#(?!\[\[).*$", "", text, flags=re.M)


def check_balances(path: Path, text: str) -> None:
    """Track quote state while counting parens/braces outside of strings."""
    text = strip_comments(text)
    paren = 0
    brace = 0
    in_string = False
    line = 1
    for char in text:
        if char == "\n":
            line += 1
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "(":
            paren += 1
        elif char == ")":
            paren -= 1
            if paren < 0:
                fail(f"{path}: unbalanced ')' at line {line}")
                return
        elif char == "{":
            brace += 1
        elif char == "}":
            brace -= 1
            if brace < 0:
                fail(f"{path}: unbalanced '}}' at line {line}")
                return
    if in_string:
        fail(f"{path}: unbalanced double quote (string not closed)")
    if paren != 0:
        fail(f"{path}: unbalanced parentheses (depth {paren} at EOF)")
    if brace != 0:
        fail(f"{path}: unbalanced braces (depth {brace} at EOF)")


def check_presets() -> None:
    presets_path = REPO_ROOT / "CMakePresets.json"
    if not presets_path.exists():
        fail("CMakePresets.json not found in the repository root")
        return
    try:
        presets = json.loads(presets_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"CMakePresets.json is not valid JSON: {error}")
        return

    configure = {p.get("name") for p in presets.get("configurePresets", [])}
    build = {p.get("name") for p in presets.get("buildPresets", [])}
    if "windows-ci-x64" not in configure:
        fail("CMakePresets.json: configure preset 'windows-ci-x64' is missing")
    if "windows-ci-x64" not in build:
        fail("CMakePresets.json: build preset 'windows-ci-x64' is missing")


def main() -> int:
    files = find_cmake_files()
    if not files:
        fail("no CMake files found — nothing to check (wrong cwd?)")

    for path in files:
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(REPO_ROOT)

        for match in INDEXING_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            fail(
                f"{relative}:{line}: array indexing in substitution "
                f"'{match.group(0)}' is a CMake syntax error (OR-6) — "
                "use list(GET VAR 0 out) instead"
            )

        check_balances(relative, text)

    check_presets()

    if failures:
        print(f"\n{len(failures)} problem(s) found.")
        return 1
    print(f"CMake lint passed ({len(files)} file(s) checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
