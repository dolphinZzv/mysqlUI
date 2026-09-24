# MySQL UI

A lightweight, self-hosted MySQL / MariaDB management tool — a Navicat-style
desktop-class web app. Go backend + React (shadcn/ui + Tailwind CSS) frontend,
shipped as a **single binary** with the UI embedded.

![status](https://img.shields.io/badge/build-go%20%2B%20vite-blue)

## Features

- **Connections** — create / edit / delete / test MySQL servers, with SSL modes.
  Profiles persist to a local JSON file.
- **MySQL over SSH** — reach databases behind a bastion host using password or
  private-key (with optional passphrase) authentication, with host-key
  verification against `~/.ssh/known_hosts` (or an opt-out).
- **Schema explorer** — sidebar tree of connections → databases → tables, with
  search, lazy loading and right-click actions.
- **Data browser** — paginated grid with inline cell editing, insert row dialog,
  delete rows, column sorting and multi-condition filtering.
- **Structure viewer** — columns, indexes, cardinality and the full `CREATE TABLE`.
- **Table designer** — create tables, add/modify/drop columns, add/drop indexes,
  rename and drop tables.
- **SQL editor** — query console with line numbers, query history, `Ctrl/⌘+Enter`
  to run, and a result grid.
- **Export** — download a table as CSV / JSON / SQL, or an entire database as SQL.
- **Import / restore** — load CSV into a table (with header mapping, truncate,
  delimiter and NULL marker) or run/restore `.sql` files (streaming parser that
  understands comments, quotes and `DELIMITER` for routines).
- **Server monitor** — overview metrics, live process list with kill / kill query,
  and searchable status/variable tables.
- **Users & privileges** — list users, `SHOW GRANTS`, create/alter/drop users and
  grant/revoke privileges with a validated privilege allow-list.
- **Routines & triggers** — browse procedures, functions, triggers and events,
  view their `SHOW CREATE` definition and drop them.
- **SQL editor** — syntax highlighting and schema-aware autocomplete
  (`Ctrl/⌘+Enter` to run, `Ctrl+Space` to complete), query history and favorites.
- **Query builder** — point-and-click column/condition/order builder.
- **Global search** — find tables and columns across all databases (`Ctrl+K`).
- **ER diagram** — visualize tables and foreign-key relationships.
- **Schema diff** — compare two tables, see added/removed/changed columns and
  indexes, and generate or execute the migration SQL.
- **Smart cells** — view/edit large text/JSON, preview images/BLOBs, set NULL,
  and jump along foreign keys.
- **UI** — multi-tab workspace with session restore, dark/light themes,
  English/Chinese interface.

## Install (one-click)

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mysqlUI/main/install.sh | bash
```

This detects your OS/architecture, downloads the latest release, verifies its
checksum, and installs `mysqlui` to `/usr/local/bin` (or `~/.local/bin`).

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/dolphinZzv/mysqlUI/main/install.ps1 | iex
```

Options (environment variables):

```bash
VERSION=v0.1.0 INSTALL_DIR=$HOME/bin curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mysqlUI/main/install.sh | bash
```

Then run:

```bash
mysqlui
# open http://localhost:8787
```

## Download manually

Grab the binary for your platform from the
[**Releases**](../../releases/latest) page:

| Platform | File |
| --- | --- |
| Linux x86_64 | `mysqlui-linux-amd64` |
| Linux arm64 | `mysqlui-linux-arm64` |
| macOS Intel | `mysqlui-darwin-amd64` |
| macOS Apple Silicon | `mysqlui-darwin-arm64` |
| Windows x86_64 | `mysqlui-windows-amd64.exe` |

The frontend is embedded in the binary — there is nothing else to install.

```bash
# Linux / macOS
chmod +x mysqlui-linux-amd64
./mysqlui-linux-amd64
# then open http://localhost:8787
```

```powershell
# Windows
.\mysqlui-windows-amd64.exe
# then open http://localhost:8787
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `MYSQLUI_ADDR` | `:8787` | Address the HTTP server listens on. |
| `MYSQLUI_DATA_DIR` | `data` | Directory holding `connections.json`. |
| `MYSQLUI_PID_FILE` | `<data>/mysqlui.pid` | PID file used by the daemon commands. |
| `MYSQLUI_LOG_FILE` | `<data>/mysqlui.log` | Log file for daemon mode. |
| `MYSQLUI_AUTH_PASSWORD` | *(unset)* | When set, the UI/API requires this password to sign in. |
| `MYSQLUI_AUTH_SECRET` | *(random)* | Secret used to sign session tokens (persisted to `<data>/auth.secret`). |
| `MYSQLUI_TLS_CERT` | *(unset)* | TLS certificate file; enables HTTPS together with the key. |
| `MYSQLUI_TLS_KEY` | *(unset)* | TLS private key file. |
| `MYSQLUI_FRONTEND_DIR` | `../frontend/dist` | Frontend directory for non-embedded builds. |

## Authentication & HTTPS

Set a password to protect the tool (recommended before exposing it to a network):

```bash
MYSQLUI_AUTH_PASSWORD='change-me' MYSQLUI_TLS_CERT=cert.pem MYSQLUI_TLS_KEY=key.pem mysqlui start
```

Sessions use a signed, HttpOnly cookie valid for 7 days. All `/api/*` routes
except `/api/auth/*`, `/api/version` and `/api/health` require authentication.

When running behind a TLS-terminating proxy, leave `MYSQLUI_TLS_*` unset and let
the proxy handle HTTPS.

## Docker

```bash
docker build -t mysqlui .
docker run -d --name mysqlui -p 8787:8787 -v mysqlui-data:/data mysqlui
# or
docker compose up -d
```

> **Security:** connection passwords (and SSH passwords / private keys) are
> stored in plaintext in `$MYSQLUI_DATA_DIR/connections.json` (mode `0600`). This
> tool is intended for local/trusted use. Set `MYSQLUI_AUTH_PASSWORD` before
> exposing it to a network, and prefer HTTPS.

## SSH tunneling

To reach a MySQL server that is only accessible from a jump host, enable
**Connect through an SSH tunnel** in the connection dialog and fill in:

| Field | Description |
| --- | --- |
| SSH host / port | Bastion host (default port `22`). |
| SSH user | Login user on the bastion. |
| Authentication | `Password` or `Private key` (PEM, OpenSSH or PKCS#8). |
| Key passphrase | Optional passphrase for an encrypted private key. |
| Ignore host key | When off, the bastion's key is verified against `~/.ssh/known_hosts`. |

The **MySQL host/port** fields are then resolved *from the bastion*, i.e. they
should be the address the bastion uses to reach MySQL (often `127.0.0.1:3306`).

If host-key verification is enabled and the host is unknown, you'll get an error
telling you to add it to `known_hosts` (e.g. `ssh-keyscan -H <host> >> ~/.ssh/known_hosts`)
or to tick **Ignore host key verification**.

## Run as a daemon

Run MySQL UI in the background with the built-in daemon commands:

```bash
mysqlui start      # start in the background
mysqlui status     # show pid, address and log location
mysqlui restart    # restart
mysqlui stop       # stop (graceful shutdown)
```

The PID file and log file default to `<MYSQLUI_DATA_DIR>/mysqlui.pid` and
`<MYSQLUI_DATA_DIR>/mysqlui.log`; override them with `MYSQLUI_PID_FILE` and
`MYSQLUI_LOG_FILE`.

### Install as a system service

```bash
mysqlui install-service           # systemd user unit (Linux) or launchd agent (macOS)
mysqlui install-service --system  # systemd system unit (Linux, needs sudo)
mysqlui install-service --print   # print the unit file without writing it
```

Linux (user unit):

```bash
systemctl --user daemon-reload
systemctl --user enable --now mysqlui
# keep it running after logout:
sudo loginctl enable-linger $USER
```

Linux (system unit):

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mysqlui
```

macOS:

```bash
launchctl load -w ~/Library/LaunchAgents/com.mysqlui.agent.plist
```

Windows — register a service manually, for example:

```powershell
sc.exe create mysqlui binPath= "C:\path\to\mysqlui.exe serve" start= auto
sc.exe start mysqlui
```

## Build from source

Requirements: Go 1.26+, Node 20+.

```bash
# build a single binary with the UI embedded
make build

# output: ./dist/mysqlui
./dist/mysqlui
```

Other targets:

```bash
make frontend   # build the React app only
make backend    # build backend (serves frontend from disk)
make dev        # run backend + frontend dev server together
make clean
```

## Development

Run the Go API on `:8787` and the Vite dev server on `:5173` (the dev server
proxies `/api` to the backend):

```bash
# terminal 1
cd backend && go run .

# terminal 2
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

## Project structure

```
.
├── backend/               # Go API server
│   ├── main.go            # entry point, routing, static/SPA serving
│   ├── daemon.go          # start/stop/status daemon + service install
│   ├── daemon_unix.go     # //go:build !windows — setsid / SIGTERM
│   ├── daemon_windows.go  # //go:build windows — detached process
│   ├── store.go           # connection store + per-database pools
│   ├── ssh.go             # SSH tunnel (jump host) support
│   ├── handlers.go        # connections, schema, rows, query
│   ├── tableops.go        # filters, export, table designer (DDL), server info
│   ├── helpers.go         # JSON, identifiers, middleware, SPA handler
│   ├── web_embed.go       # //go:build embed  — embedded frontend
│   └── web_disk.go        # //go:build !embed — frontend from disk
├── frontend/              # React + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── App.tsx
│       ├── components/    # Sidebar, TableTab, QueryTab, DataGrid, dialogs…
│       ├── components/ui/ # shadcn primitives
│       └── lib/           # api client, types, helpers
└── .github/workflows/     # CI + release automation
```

## Release automation

`.github/workflows/release.yml` builds the frontend, embeds it into the Go
binary, cross-compiles for Linux/macOS/Windows (amd64 + arm64) and publishes a
GitHub Release with the binaries and `checksums.txt`.

To cut a release, push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also trigger it manually from **Actions → Release → Run workflow**.

## API (summary)

| Method | Path | Description |
| --- | --- | --- |
| `GET/POST` | `/api/connections` | list / create connections |
| `PUT/DELETE` | `/api/connections/{id}` | update / delete |
| `POST` | `/api/connections/test` | test a connection |
| `POST` | `/api/connections/{id}/test` | test a saved connection |
| `GET` | `/api/connections/{id}/info` | server version/host info |
| `GET` | `/api/connections/{id}/databases` | list databases |
| `GET` | `/api/connections/{id}/databases/{db}/tables` | list tables |
| `POST` | `/api/connections/{id}/databases/{db}/tables` | create table |
| `GET` | `…/tables/{table}/structure` | table structure |
| `GET` | `…/tables/{table}/data` | paginated rows (`limit`, `offset`, `orderBy`, `filters`) |
| `POST/PUT/DELETE` | `…/tables/{table}/rows` | insert / update / delete rows |
| `POST/PUT/DELETE` | `…/tables/{table}/columns[/{col}]` | add / modify / drop column |
| `POST/DELETE` | `…/tables/{table}/indexes[/{idx}]` | add / drop index |
| `GET` | `…/tables/{table}/export?format=csv\|json\|sql` | export table |
| `GET` | `…/databases/{db}/export?format=sql` | export database |
| `POST` | `/api/connections/{id}/query` | run arbitrary SQL |

## License

MIT
