import { AechatError } from "../core/errors.js";

export interface ParsedArgs {
  values: Map<string, string>;
  flags: Set<string>;
}

/**
 * Minimal `--key value` / `--flag` parser. Values that start with `--` are
 * rejected as missing so a typo cannot silently become a positional value.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith("--")) {
      throw new AechatError("invalid_input", `unexpected argument: ${arg ?? ""}`);
    }
    const key = arg.slice(2);
    if (key === "") {
      throw new AechatError("invalid_input", "empty option name");
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { values, flags };
}

export function requiredValue(args: ParsedArgs, key: string): string {
  const value = args.values.get(key);
  if (value === undefined) {
    throw new AechatError("invalid_input", `missing --${key}`);
  }
  return value;
}

export function optionalValue(args: ParsedArgs, key: string): string | undefined {
  return args.values.get(key);
}
