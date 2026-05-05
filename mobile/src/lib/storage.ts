import { useSyncExternalStore } from "react"

// Minimal localStorage-backed store + React hook.
//
// Mirrors the *consumption shape* of @plasmohq/storage's useStorage just
// enough that the ported components can swap to a simpler `(key, default)`
// signature with one find-and-replace per call site. We don't reimplement
// chrome.storage's namespaced areas — there's a single localStorage origin
// per PWA install, which is exactly what we want here.
//
// Cross-tab updates: the native `storage` event fires on OTHER tabs when
// localStorage is mutated, so we forward it through the same notify path.
// Same-tab writes go through `notifyKey` directly because the `storage`
// event doesn't fire in the originating tab.

const subs = new Map<string, Set<() => void>>()

function readKey<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeKey(key: string, value: unknown): void {
  if (typeof window === "undefined") return
  if (value === undefined || value === null) {
    window.localStorage.removeItem(key)
  } else {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
  notifyKey(key)
}

function subscribe(key: string, fn: () => void): () => void {
  let set = subs.get(key)
  if (!set) {
    set = new Set()
    subs.set(key, set)
  }
  set.add(fn)
  return () => {
    subs.get(key)?.delete(fn)
  }
}

export function notifyKey(key: string): void {
  subs.get(key)?.forEach((fn) => fn())
}

export function useStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => readKey<T>(key, defaultValue),
    () => defaultValue
  )
  const setValue = (next: T) => writeKey(key, next)
  return [value, setValue]
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    return readKey<T>(key, fallback)
  },
  set(key: string, value: unknown): void {
    writeKey(key, value)
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key) {
      notifyKey(e.key)
    } else {
      // localStorage.clear() — wake every subscriber.
      subs.forEach((set) => set.forEach((fn) => fn()))
    }
  })
}
