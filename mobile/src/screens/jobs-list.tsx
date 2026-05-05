import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { listMyJobs } from "~/lib/api"
import { useStorage } from "~/lib/storage"
import type { MobileJob } from "~/lib/types"

// Top-level screen — the user's open sourcing jobs. Each card opens that
// job's pipeline (CandidatePager) at index 0.

type State =
  | { kind: "loading" }
  | { kind: "ready"; jobs: MobileJob[] }
  | { kind: "error"; message: string }

export function JobsList() {
  const [secret] = useStorage<string>("extensionSecret", "")
  const [state, setState] = useState<State>({ kind: "loading" })
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    listMyJobs({ secret })
      .then((resp) => {
        if (cancelled) return
        if (resp.ok) {
          setState({ kind: "ready", jobs: resp.data.jobs })
        } else {
          setState({ kind: "error", message: resp.error })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load jobs"
        })
      })
    return () => {
      cancelled = true
    }
  }, [secret])

  const retry = () => {
    setState({ kind: "loading" })
    listMyJobs({ secret }).then((resp) => {
      if (resp.ok) {
        setState({ kind: "ready", jobs: resp.data.jobs })
      } else {
        setState({ kind: "error", message: resp.error })
      }
    })
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.title}>Sourcing Jobs</h1>
        <p style={styles.subtitle}>Pick a job to walk through its pipeline.</p>
      </header>

      {state.kind === "loading" && (
        <div style={styles.statusBlock}>
          <div style={styles.spinner} />
          <p style={styles.statusText}>Loading your jobs…</p>
        </div>
      )}

      {state.kind === "error" && (
        <div style={styles.statusBlock}>
          <p style={styles.errorText}>{state.message}</p>
          <button type="button" onClick={retry} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      {state.kind === "ready" && state.jobs.length === 0 && (
        <div style={styles.statusBlock}>
          <p style={styles.statusText}>No open sourcing jobs.</p>
          <p style={styles.statusSubtext}>
            Add a sourced candidate to one of your jobs in Recruiterflow and
            they'll show up here.
          </p>
        </div>
      )}

      {state.kind === "ready" && state.jobs.length > 0 && (
        <ul style={styles.list}>
          {state.jobs.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                style={styles.card}
                onClick={() =>
                  navigate(`/jobs/${job.id}/candidate/0`)
                }>
                <div style={styles.cardMain}>
                  <span style={styles.cardName}>{job.name}</span>
                  <span style={styles.cardCompany}>{job.company}</span>
                </div>
                <span style={styles.cardChevron} aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    flex: 1,
    minHeight: "100vh",
    width: "100%",
    maxWidth: "640px",
    margin: "0 auto",
    padding: "56px 16px 32px"
  },
  header: {
    margin: "0 0 20px 0",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "0 4px"
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
    color: "#3c4043"
  },
  statusBlock: {
    width: "100%",
    minHeight: "240px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "24px 16px",
    textAlign: "center"
  },
  spinner: {
    width: "26px",
    height: "26px",
    border: "3px solid #e3e6ea",
    borderTopColor: "#0a66c2",
    borderRadius: "50%",
    animation: "spin 800ms linear infinite"
  },
  statusText: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "#15171a"
  },
  statusSubtext: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 500,
    color: "#5f6368",
    maxWidth: "360px",
    lineHeight: 1.4
  },
  errorText: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 600,
    color: "#a82a20",
    maxWidth: "360px",
    lineHeight: 1.4
  },
  retryButton: {
    padding: "10px 18px",
    backgroundColor: "#0a66c2",
    color: "#ffffff",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer"
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  card: {
    width: "100%",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    padding: "16px 18px",
    backgroundColor: "#ffffff",
    border: "1px solid #e3e6ea",
    borderRadius: "14px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left"
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  },
  cardName: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#15171a",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  cardCompany: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#3c4043",
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  cardChevron: {
    flexShrink: 0,
    fontSize: "26px",
    fontWeight: 400,
    color: "#98a2ad",
    lineHeight: 1,
    paddingLeft: "8px"
  }
}
