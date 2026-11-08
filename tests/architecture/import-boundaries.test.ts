import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

type Layer = "adapters" | "cli" | "contracts" | "core" | "runtime" | "other";

function layerOf(path: string): Layer {
  const first = relative(SRC, path).split(sep)[0];
  switch (first) {
    case "adapters":
    case "cli":
    case "contracts":
    case "core":
    case "runtime":
      return first;
    default:
      return "other";
  }
}

/** Every import specifier in a file, including dynamic import(). */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

interface Violation {
  file: string;
  specifier: string;
  target: string;
}

function violations(fromLayers: Layer[], forbidden: Layer[]): Violation[] {
  const found: Violation[] = [];
  for (const file of sourceFiles(SRC)) {
    if (!fromLayers.includes(layerOf(file))) {
      continue;
    }
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        continue;
      }
      const target = normalize(join(dirname(file), specifier));
      const targetLayer = layerOf(target);
      if (forbidden.includes(targetLayer)) {
        found.push({
          file: relative(SRC, file),
          specifier,
          target: targetLayer,
        });
      }
    }
  }
  return found;
}

describe("import boundaries", () => {
  it("core does not depend on cli, runtime or adapters", () => {
    expect(violations(["core"], ["cli", "runtime", "adapters"])).toEqual([]);
  });

  it("adapters do not depend on cli or runtime", () => {
    expect(violations(["adapters"], ["cli", "runtime"])).toEqual([]);
  });

  it("contracts do not depend on cli or runtime", () => {
    expect(violations(["contracts"], ["cli", "runtime"])).toEqual([]);
  });

  it("runtime does not depend on cli", () => {
    expect(violations(["runtime"], ["cli"])).toEqual([]);
  });

  it("the library entry does not export the CLI entry point", () => {
    const entry = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(entry).not.toMatch(/from\s+["']\.\/cli\//);
  });
});
