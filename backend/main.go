package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	for _, arg := range os.Args[1:] {
		if arg == "--version" || arg == "-version" || arg == "-v" {
			fmt.Printf("mysqlui %s\n", version)
			return
		}
	}

	dataDir := os.Getenv("MYSQLUI_DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}

	store, err := NewStore(filepath.Join(dataDir, "connections.json"))
	if err != nil {
		log.Fatalf("failed to init store: %v", err)
	}

	srv := &Server{store: store}
	mux := http.NewServeMux()
	srv.routes(mux)
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"version": version})
	})

	// The frontend is either embedded (release builds, -tags embed) or served
	// from disk (development). See web_embed.go / web_disk.go.
	serveFrontend(mux)

	addr := os.Getenv("MYSQLUI_ADDR")
	if addr == "" {
		addr = ":8787"
	}

	handler := corsMiddleware(loggingMiddleware(mux))
	log.Printf("MySQL UI %s listening on %s", version, addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}
