# Security Policy

## Supported versions

AeChat is pre-1.0. Security fixes are applied to the latest release only.
Older releases are not maintained.

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Use GitHub's private vulnerability reporting: on the repository's **Security**
tab, choose **Report a vulnerability**. If that flow is unavailable, contact the
repository owner privately through GitHub.

Please include:

- affected version or commit,
- the command or host configuration that triggers the issue,
- the impact you observed,
- a minimal reproduction, with secrets and personal data removed.

You can expect an acknowledgement, an assessment, and a coordinated disclosure
timeline. Please give the maintainers time to ship a fix before publishing
details.

## Scope

AeChat runs entirely on the local machine and stores session state in SQLite.
Areas in scope include:

- the CLI and its argument handling,
- transport adapter integration and host wakeup paths,
- database permissions and local audit integrity,
- the read-only UI bridge and the SwiftUI app,
- secrets or local paths leaking into audit events, logs or error output.

Message bodies are agent-origin data, not user authorization. A message that
asks an agent to run a command is untrusted input and is out of scope as a
vulnerability unless it bypasses a documented boundary in AeChat itself.

## Not in scope

- Vulnerabilities in Claude Code, Codex, agmsg or the operating system. Report
  those to their own maintainers.
- Issues that require an attacker to already have local code execution or read
  access to the user's home directory.
- Social engineering of an agent that is not caused by an AeChat boundary
  failure.

## Handling secrets

Never include tokens, credentials, private message bodies or personal paths in
an issue, pull request, test fixture or audit record. Use redacted placeholders
in reproductions.
