#!/usr/bin/env node
/**
 * Test audit: fail on focused or skipped tests.
 *
 * A committed `.only` silently disables the rest of the suite, and a skipped
 * test hides behavior that is no longer verified. Coverage thresholds are
 * enforced separately by `vitest --coverage`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const testsRoot = join(root, "tests");
const violations = [];
let testFiles = 0;

const pattern = /\b(?:it|test|describe)\.(?:only|skip|todo)\s*\(/;

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.test\.(?:ts|mts)$/.test(entry)) {
      continue;
    }
    testFiles += 1;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        violations.push(
          `${relative(root, path)}:${index + 1}: ${line.trim().slice(0, 120)}`,
        );
      }
    });
  }
}

walk(testsRoot);

if (testFiles === 0) {
  console.error("test audit: no test files found");
  process.exit(1);
}

if (violations.length > 0) {
  console.error("test audit: focused or skipped tests are not allowed");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`test audit: ${testFiles} test files, no focused or skipped tests`);
