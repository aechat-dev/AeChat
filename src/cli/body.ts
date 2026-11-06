import { readFileSync } from "node:fs";

import { AechatError } from "../core/errors.js";
import { optionalValue, type ParsedArgs } from "./args.js";

export function bodyFromArgs(args: ParsedArgs): string {
  const body = optionalValue(args, "body");
  const bodyFile = optionalValue(args, "body-file");
  if ((body === undefined) === (bodyFile === undefined)) {
    throw new AechatError(
      "invalid_input",
      "exactly one of --body or --body-file is required",
    );
  }
  if (body !== undefined) {
    return body;
  }
  try {
    return readFileSync(bodyFile as string, "utf8");
  } catch (error) {
    throw new AechatError("invalid_input", `cannot read --body-file: ${bodyFile}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
