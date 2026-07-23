#!/usr/bin/env python3
"""Validate the single-source workspace version and print it."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import NoReturn


ROOT = Path(__file__).resolve().parents[1]
STABLE_VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
PACKAGE_NAMES = ("dinotty-server", "dinotty-desktop")


def fail(message: str) -> NoReturn:
    print(f"version check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_toml(path: Path) -> dict[str, object]:
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        fail(f"cannot parse {path.relative_to(ROOT)}: {error}")


def require_workspace_version(package: object, manifest: str) -> None:
    if not isinstance(package, dict):
        fail(f"{manifest} has no [package] table")
    if package.get("version") != {"workspace": True}:
        fail(f"{manifest} [package] must set version.workspace = true")


def validate_structure() -> str:
    root_manifest = load_toml(ROOT / "Cargo.toml")
    workspace = root_manifest.get("workspace")
    if not isinstance(workspace, dict):
        fail("Cargo.toml has no [workspace] table")
    workspace_package = workspace.get("package")
    if not isinstance(workspace_package, dict):
        fail("Cargo.toml has no [workspace.package] table")
    version = workspace_package.get("version")
    if not isinstance(version, str) or not STABLE_VERSION.fullmatch(version):
        fail("[workspace.package].version must be stable MAJOR.MINOR.PATCH")

    require_workspace_version(root_manifest.get("package"), "Cargo.toml")
    desktop_manifest = load_toml(ROOT / "src-tauri" / "Cargo.toml")
    require_workspace_version(desktop_manifest.get("package"), "src-tauri/Cargo.toml")

    config_path = ROOT / "src-tauri" / "tauri.conf.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot parse src-tauri/tauri.conf.json: {error}")
    if not isinstance(config, dict):
        fail("src-tauri/tauri.conf.json must contain a JSON object")
    if "version" in config:
        fail("src-tauri/tauri.conf.json must not define top-level version")
    return version


def load_metadata() -> dict[str, object]:
    command = [
        "cargo",
        "metadata",
        "--locked",
        "--no-deps",
        "--format-version",
        "1",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        fail(f"cannot run cargo metadata: {error}")
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        fail("cargo metadata --locked failed")
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        fail(f"cargo metadata returned invalid JSON: {error}")
    if not isinstance(metadata, dict):
        fail("cargo metadata did not return a JSON object")
    return metadata


def validate_metadata(expected_version: str) -> None:
    metadata = load_metadata()
    workspace_members = metadata.get("workspace_members")
    packages = metadata.get("packages")
    if not isinstance(workspace_members, list) or not isinstance(packages, list):
        fail("cargo metadata is missing workspace members or packages")

    member_ids = set(workspace_members)
    members = [
        package
        for package in packages
        if isinstance(package, dict) and package.get("id") in member_ids
    ]
    for name in PACKAGE_NAMES:
        matches = [package for package in members if package.get("name") == name]
        if len(matches) != 1:
            fail(f"workspace must contain exactly one {name} package")
        version = matches[0].get("version")
        if version != expected_version:
            fail(f"{name} resolves to {version!r}, expected {expected_version}")


def main() -> None:
    version = validate_structure()
    validate_metadata(version)
    print(version)


if __name__ == "__main__":
    main()
