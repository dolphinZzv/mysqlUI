package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// version is injected at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// `start`/`stop`/`status`/... are handled here; everything else serves.
	if handleDaemonCommand(os.Args[1:]) {
		return
	}
	runServer()
}

func runServer() {
	dir := dataDir()

	store, err := NewStore(filepath.Join(dir, "connections.json"))
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

	addr := listenAddr()
	handler := corsMiddleware(loggingMiddleware(mux))
	httpServer := &http.Server{Addr: addr, Handler: handler}

	go func() {
		log.Printf("MySQL UI %s listening on %s", version, addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Wait for a termination signal and shut down gracefully.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Printf("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)

	// Remove the pid file if we were launched as a daemon.
	if os.Getenv("MYSQLUI_DAEMON") == "1" {
		_ = os.Remove(pidFilePath())
	}
	log.Printf("stopped")
}
