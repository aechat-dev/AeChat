# CLI reference

Run `aechat --help` for the command list and `aechat <command> --help` for the
options of one command. All commands accept `--json` where the output is meant
for a program; prefer it in agent conversations.

| Command | Purpose |
|---|---|
| `init` / `setup` | Create the database and install host skills |
| `register` / `confirm` | Create a session and confirm its transport binding |
| `list` / `whoami` | Discover sessions and capabilities |
| `show` | Read one message by ID |
| `send` | Send a notification or request |
| `receive` / `ack` | Claim one delivery, then acknowledge it after processing |
| `inbox` | Read pending deliveries in a batch |
| `reply` | Answer a request |
| `wait` | Block until a correlated reply arrives |
| `heartbeat` | Keep a session marked online |
| `probe` | Record one capability observation |
| `cancel` / `retry` | Cancel a request or retry a delivery |
| `resume` / `leave` | Rebind or retire a session |
| `log` / `history` | Inspect one audit chain or one session's messages |
| `doctor` | Check the local environment |

## Request lifecycle

```bash
# In the worker conversation
aechat inbox --session "<worker_id>" --json
aechat ack --session "<worker_id>" --delivery "<delivery_token>"
aechat reply --session "<worker_id>" --request "<request_id>" --body "done"

# Back in the planner conversation
aechat wait --session "<planner_id>" --request "<request_id>" --timeout 300 --json
```

Installation, registration and host skills are covered in
[install.md](install.md). For the request lifecycle and delivery guarantees,
see [reliability.md](reliability.md).
