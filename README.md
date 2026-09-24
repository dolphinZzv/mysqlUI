# MySQL UI

A lightweight, self-hosted MySQL / MariaDB management tool — a Navicat-style
desktop-class web app. Go backend + React (shadcn/ui + Tailwind CSS) frontend,
shipped as a **single binary** with the UI embedded.

![status](https://img.shields.io/badge/build-go%20%2B%20vite-blue)

## Features

- **Connections** — create / edit / delete / test MySQL servers, with SSL modes.
  Profiles persist to a local JSON file.
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
- **UI** — multi-tab workspace, dark/light themes, keyboard-friendly.

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
| `MYSQLUI_FRONTEND_DIR` | `../frontend/dist` | Frontend directory for non-embedded builds. |

> **Security:** connection passwords are stored in plaintext in
> `$MYSQLUI_DATA_DIR/connections.json` (mode `0600`). This tool is intended for
> local/trusted use. Do not expose it to the public internet.

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
│   ├── store.go           # connection store + per-database pools
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
