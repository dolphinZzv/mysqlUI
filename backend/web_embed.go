//go:build embed

package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

//go:embed all:web/dist
var embeddedFrontend embed.FS

// serveFrontend serves the frontend bundled into the binary at build time.
func serveFrontend(mux *http.ServeMux) {
	sub, err := fs.Sub(embeddedFrontend, "web/dist")
	if err != nil {
		log.Fatalf("embedded frontend missing: %v", err)
	}
	mux.Handle("/", spaFSHandler(sub))
	log.Printf("serving embedded frontend")
}

// spaFSHandler serves static files from fsys and falls back to index.html so
// client-side routing works.
func spaFSHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := fsys.Open(p); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		data, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
	})
}
