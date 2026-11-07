#!/usr/bin/env bash
#
# Build the macOS package and run its checks. XCTest is unavailable with
# Command Line Tools only, so the checks are an executable target.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

swift build --package-path "$ROOT/apps/macos"
swift run --package-path "$ROOT/apps/macos" AeChatChecks
