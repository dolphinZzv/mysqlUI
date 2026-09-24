SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND := frontend
BACKEND  := backend
DIST     := dist
VERSION  ?= dev

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install frontend dependencies
	cd $(FRONTEND) && npm install

.PHONY: frontend
frontend: ## Build the React frontend
	cd $(FRONTEND) && npm run build

.PHONY: stage
stage: frontend ## Copy the built frontend where the embed build expects it
	rm -rf $(BACKEND)/web/dist
	mkdir -p $(BACKEND)/web/dist
	cp -r $(FRONTEND)/dist/. $(BACKEND)/web/dist/

.PHONY: backend
backend: ## Build the backend (serves frontend from disk)
	cd $(BACKEND) && go build -o ../$(DIST)/mysqlui .

.PHONY: build
build: stage ## Build a single binary with the UI embedded
	mkdir -p $(DIST)
	cd $(BACKEND) && CGO_ENABLED=0 go build -tags embed -trimpath \
		-ldflags "-s -w -X main.version=$(VERSION)" -o ../$(DIST)/mysqlui .

.PHONY: run
run: build ## Build and run
	./$(DIST)/mysqlui

.PHONY: dev
dev: ## Run backend and frontend dev servers together
	@echo "Starting backend (:8787) and frontend (:5173)..."
	@trap 'kill 0' INT TERM; \
		( cd $(BACKEND) && go run . ) & \
		( cd $(FRONTEND) && npm run dev ) & \
		wait

.PHONY: test
test: ## Run Go tests and frontend typecheck
	cd $(BACKEND) && go vet ./... && go test ./...
	cd $(FRONTEND) && npm run typecheck

.PHONY: docker
docker: ## Build the Docker image
	docker build -t mysqlui:latest .

.PHONY: docker-run
docker-run: ## Run the Docker image
	docker run --rm -p 8787:8787 -v mysqlui-data:/data -e MYSQLUI_DATA_DIR=/data mysqlui:latest

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf $(DIST) $(BACKEND)/web/dist $(FRONTEND)/dist $(FRONTEND)/*.tsbuildinfo
