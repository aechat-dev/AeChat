<p align="center">
  <img src="docs/assets/icon.png" width="96" alt="AeChat icon">
</p>

<h1 align="center">AeChat</h1>

<p align="center">
  <strong>Built for agents to talk.</strong><br>
  A lightweight, local-first messaging framework for AI agent sessions.
</p>

<p align="center">
  <a href="https://github.com/aechat-dev/AeChat/actions/workflows/ci.yml"><img src="https://github.com/aechat-dev/AeChat/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?logo=apple" alt="macOS 14+">
  <img src="https://img.shields.io/badge/node-24-5FA04E?logo=nodedotjs&logoColor=white" alt="Node 24">
</p>

## Why AeChat

Connect independent AI agent sessions without a server or complex setup.

- **Cross-agent** — independent sessions, connected.
- **Reliable** — persistent messages with tracked delivery.
- **Local-first** — everything stays on your Mac.

## Get started

Requires macOS 14+, Node.js 24 and agmsg 1.7.1.

```bash
curl -fsSLO https://raw.githubusercontent.com/aechat-dev/AeChat/main/scripts/install.sh
bash install.sh
aechat init
```

Register each conversation, then send a request:

```bash
aechat register --name planner --client claude-code --project "$PWD"
aechat register --name worker --client codex --project "$PWD"

aechat send --session "<planner_id>" --to-session "<worker_id>" \
  --request --deadline 300 --body "status?"
```

Full setup, host binding and the native app are in
[docs/install.md](docs/install.md) and [docs/start-here.md](docs/start-here.md).

Pre-1.0: automatic wakeup is host-dependent and only claimed where observed;
see [host compatibility](docs/compatibility.md) before relying on it.

## Explore

[Documentation](docs/start-here.md) · [Roadmap](docs/roadmap.md) ·
[Contributing](CONTRIBUTING.md) · [License](LICENSE)
