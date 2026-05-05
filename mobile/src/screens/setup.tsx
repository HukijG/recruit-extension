import { useEffect, useRef, useState } from "react"

import { storage } from "~/lib/storage"

// First-run setup screen. Captures consultantFirstName + extensionSecret
// into localStorage; once both are non-empty, the App's auth gate flips
// and the routed flow takes over.

export function Setup() {
  const [name, setName] = useState(
    () => storage.get<string>("consultantFirstName", "") ?? ""
  )
  const [secret, setSecret] = useState(
    () => storage.get<string>("extensionSecret", "") ?? ""
  )
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const trimmedName = name.trim()
  const trimmedSecret = secret.trim()
  const canSave = trimmedName.length > 0 && trimmedSecret.length > 0

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    storage.set("consultantFirstName", trimmedName)
    storage.set("extensionSecret", trimmedSecret)
  }

  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <header style={styles.header}>
          <h1 style={styles.title}>Recruiter Pipeline</h1>
          <p style={styles.subtitle}>
            Walk-around companion for your LinkedIn Recruiter sourcing flow.
          </p>
        </header>
        <form style={styles.form} onSubmit={handleSave}>
          <label style={styles.field}>
            <span style={styles.label}>Your first name</span>
            <input
              ref={nameRef}
              type="text"
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Joel"
              autoComplete="off"
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Extension secret</span>
            <input
              type="password"
              style={styles.input}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter secret…"
              autoComplete="off"
            />
            <span style={styles.hint}>
              Same secret you use in the desktop extension. Stored locally on
              this device only.
            </span>
          </label>
          <button
            type="submit"
            disabled={!canSave}
            style={{
              ...styles.saveButton,
              ...(canSave ? null : styles.saveButtonDisabled)
            }}>
            Continue
          </button>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    flex: 1,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    backgroundColor: "#f7f8fa"
  },
  card: {
    width: "100%",
    maxWidth: "440px",
    backgroundColor: "#ffffff",
    border: "1px solid #e3e6ea",
    borderRadius: "18px",
    boxShadow: "0 16px 40px rgba(15,23,42,0.08)",
    padding: "26px 24px"
  },
  header: {
    margin: "0 0 20px 0",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  title: {
    margin: 0,
    fontSize: "26px",
    fontWeight: 700,
    color: "#0d0d0d",
    letterSpacing: "-0.01em",
    fontFamily:
      '"ui-rounded", "SF Pro Rounded", "SF Pro Display", system-ui, sans-serif'
  },
  subtitle: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 500,
    color: "#3c4043",
    lineHeight: 1.4
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  label: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#3c4043",
    textTransform: "uppercase"
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    fontSize: "15px",
    lineHeight: 1.4,
    color: "#15171a",
    backgroundColor: "#ffffff",
    border: "1px solid #d6dbe1",
    borderRadius: "10px",
    outline: "none",
    fontFamily: "inherit"
  },
  hint: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#5f6368",
    lineHeight: 1.4,
    marginTop: "2px"
  },
  saveButton: {
    marginTop: "8px",
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "13px 14px",
    backgroundColor: "#0a66c2",
    color: "#ffffff",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 1px 0 rgba(0,0,0,0.04)"
  },
  saveButtonDisabled: {
    backgroundColor: "#eef0f2",
    color: "#98a2ad",
    borderColor: "#e3e6ea",
    cursor: "not-allowed",
    boxShadow: "none"
  }
}
