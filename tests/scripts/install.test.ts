import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/install.sh", import.meta.url),
);
const version = "0.1.0-alpha.1";
const asset = `aechat-${version}.tgz`;

function run(...args: string[]) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8" });
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function runInstall(
  base: string,
  ...args: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn("bash", [script, "--version", `v${version}`, ...args], {
      env: { ...process.env, AECHAT_INSTALL_BASE: base },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function withRelease(
  files: Record<string, string>,
  test: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    const name = request.url?.split("/").pop() ?? "";
    const body = files[name];
    if (body === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200);
    response.end(body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await test(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

describe("install script", () => {
  it("prints a deterministic plan for an explicit version", () => {
    const result = run("--version", version, "--dry-run");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`tag: v${version}`);
    expect(result.stdout).toContain(asset);
    expect(result.stdout).toContain("SHA256SUMS");
    expect(result.stdout).toContain("npm install -g");
  });

  it("honors a custom prefix in the plan", () => {
    const result = run(
      "--version",
      `v${version}`,
      "--prefix",
      "/tmp/aechat-prefix",
      "--dry-run",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "npm install -g --prefix /tmp/aechat-prefix",
    );
  });

  it("rejects an unknown option", () => {
    const result = run("--bogus");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown option");
  });

  it("rejects a version that could escape the download directory", () => {
    const result = run("--version", "../evil", "--dry-run");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid release version");
  });

  it("fails when SHA256SUMS does not name the tarball", async () => {
    await withRelease(
      {
        [asset]: "payload",
        SHA256SUMS: `${sha("other")}  other.tgz\n`,
      },
      async (base) => {
        const result = await runInstall(base);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("exactly once");
      },
    );
  });

  it("fails when SHA256SUMS names the tarball twice", async () => {
    await withRelease(
      {
        [asset]: "payload",
        SHA256SUMS: `${sha("payload")}  ${asset}\n${sha("payload")}  ${asset}\n`,
      },
      async (base) => {
        const result = await runInstall(base);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("exactly once");
      },
    );
  });

  it("fails when the checksum does not match", async () => {
    await withRelease(
      {
        [asset]: "payload",
        SHA256SUMS: `${sha("different")}  ${asset}\n`,
      },
      async (base) => {
        const result = await runInstall(base);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("checksum mismatch");
      },
    );
  });

  it("documents its options in help", () => {
    const result = run("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--version <tag>");
    expect(result.stdout).toContain("--stable");
    expect(result.stdout).toContain("--dry-run");
  });
});
