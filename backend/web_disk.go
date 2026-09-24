//go:build !embed

package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// serveFrontend serves the built SPA from a directory on disk. This is used for
// development builds; release builds embed the assets instead (web_embed.go).
func serveFrontend(mux *http.ServeMux) {
	dir := os.Getenv("MYSQLUI_FRONTEND_DIR")
	if dir == "" {
		dir = filepath.Join("..", "frontend", "dist")
	}
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		mux.Handle("/", spaHandler(dir))
		log.Printf("serving frontend from %s", dir)
		return
	}
	log.Printf("frontend build not found (looked in %q); serving API only", dir)
}
