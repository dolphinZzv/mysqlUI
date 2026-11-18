// Catch browser SDK integration.
//
// Configuration is build-time only (Vite exposes VITE_* variables). The ingest
// key is write-only and safe to ship in the bundle; leave it empty to disable
// reporting entirely.

interface CatchUser {
  id?: string
  email?: string
  username?: string
}

interface CatchSdk {
  setUser(user: CatchUser | null): void
  captureError(error: unknown, context?: Record<string, unknown>): void
  log(level: "debug" | "info" | "warn" | "error" | "fatal", message: string, context?: Record<string, unknown>): void
}

declare global {
  interface Window {
    Catch?: CatchSdk
  }
}

const baseURL = (import.meta.env.VITE_CATCH_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? ""
const ingestKey = (import.meta.env.VITE_CATCH_INGEST_KEY as string | undefined)?.trim() ?? ""
const environment = (import.meta.env.VITE_CATCH_ENV as string | undefined)?.trim() || "production"
const service = (import.meta.env.VITE_CATCH_SERVICE as string | undefined)?.trim() || "mysqlui-web"
const release = (import.meta.env.VITE_CATCH_RELEASE as string | undefined)?.trim() || ""

let ready = false
let pendingUser: CatchUser | null | undefined
const pendingErrors: Array<{ error: unknown; context?: Record<string, unknown> }> = []

function flushPending() {
  if (!ready) return
  if (pendingUser !== undefined) {
    window.Catch?.setUser(pendingUser)
    pendingUser = undefined
  }
  for (const item of pendingErrors.splice(0)) {
    window.Catch?.captureError(item.error, item.context)
  }
}

export async function initCatch() {
  if (typeof window === "undefined" || !baseURL || !ingestKey || window.Catch) return
  // The server-side switch is authoritative; an unreachable endpoint keeps the
  // build-time default so older deployments keep working.
  try {
    const res = await fetch("/api/telemetry", { cache: "no-store", credentials: "same-origin" })
    if (res.ok) {
      const body = (await res.json()) as { data?: { errorTracking?: boolean }; errorTracking?: boolean }
      if ((body.data?.errorTracking ?? body.errorTracking) === false) return
    }
  } catch {
    /* keep the build-time default */
  }
  const script = document.createElement("script")
  script.src = `${baseURL}/catch-sdk.js`
  script.async = true
  script.crossOrigin = "anonymous"
  script.dataset.key = ingestKey
  script.dataset.endpoint = `${baseURL}/api/ingest`
  script.dataset.env = environment
  script.dataset.service = service
  if (release) script.dataset.release = release
  script.addEventListener("load", () => {
    ready = true
    flushPending()
  })
  document.head.appendChild(script)
}

export function identifyCatchUser(user: { id?: string; email?: string; name?: string; username?: string } | null) {
  if (!user) {
    clearCatchUser()
    return
  }
  pendingUser = {
    id: user.id,
    email: user.email,
    username: user.username || user.name,
  }
  flushPending()
}

export function clearCatchUser() {
  pendingUser = null
  if (ready) window.Catch?.setUser(null)
}

export function captureCatchError(error: unknown, context?: Record<string, unknown>) {
  if (ready && window.Catch) {
    window.Catch.captureError(error, context)
    return
  }
  pendingErrors.push({ error, context })
  if (pendingErrors.length > 20) pendingErrors.shift()
}

export function catchLog(level: "debug" | "info" | "warn" | "error" | "fatal", message: string, context?: Record<string, unknown>) {
  if (ready) window.Catch?.log(level, message, context)
}
