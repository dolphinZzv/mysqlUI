# syntax=docker/dockerfile:1

# ---- build the frontend ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- build the Go binary with the UI embedded ----
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./web/dist
RUN CGO_ENABLED=0 go build -tags embed -trimpath -ldflags "-s -w" -o /mysqlui .

# ---- runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 mysqlui
COPY --from=backend /mysqlui /usr/local/bin/mysqlui
USER mysqlui
WORKDIR /data
ENV MYSQLUI_DATA_DIR=/data \
    MYSQLUI_ADDR=:8787
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["mysqlui"]
CMD ["serve"]
