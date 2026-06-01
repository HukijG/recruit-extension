import { sendToBackground } from "@plasmohq/messaging"
import { useContext, useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import { localStore } from "~lib/constants"
import { MusicRemoteContext } from "~lib/contexts"
import { useInterpolatedPosition } from "~lib/musicRemote"
import type { MusicPlaylistResult, MusicSongResult } from "~lib/types"

// --- Now-Playing Music Bar ---
//
// Self-contained feature module. Owns the fixed bottom bar (art + title /
// artist + transport + volume + a search trigger), the expanded search
// overlay (which mirrors text-popover.tsx's popover conventions — 220ms
// pop-in, 160ms backdrop fade, dimmed backdrop, explicit-close-only), and the
// CSS-class / keyframe injection it needs. sidepanel.tsx only MOUNTS it as
// base-page chrome and supplies data via MusicRemoteContext; no feature UI
// lives in sidepanel.
//
// HEIGHT SEAM: the bar is position:fixed, so it doesn't occupy layout flow.
// It writes its own height to the document-root CSS var --lr-music-bar-height
// in ONE effect declared before any early return; sidepanel reads that var to
// reserve bottom padding, and candidate-mode toasts read it to sit above the
// bar. The var is reset to 0px whenever the bar isn't actually painting
// (suppressed, no track, or the slot is absent) and on unmount.

// Fixed bar height (content box). 64px clears 44px art + 10px vertical
// padding on each axis comfortably and keeps the transport row a single line.
const BAR_HEIGHT_PX = 64
const BAR_HEIGHT_VAR = "--lr-music-bar-height"

const MUSIC_BAR_STYLE_ATTR = "data-lr-music-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${MUSIC_BAR_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(MUSIC_BAR_STYLE_ATTR, "")
  styleEl.textContent = `
    @keyframes lr-music-pop-in {
      0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes lr-music-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes lr-music-bar-rise {
      from { opacity: 0; transform: translateY(100%); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ----- Fixed bar shell ----- */
    .lr-music-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: ${BAR_HEIGHT_PX}px;
      box-sizing: border-box;
      z-index: 150;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background-color: #ffffff;
      border-top: 1px solid #e3e6ea;
      box-shadow: 0 -4px 16px rgba(15,23,42,0.08);
      animation: lr-music-bar-rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .lr-music-art {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 8px;
      object-fit: cover;
      background-color: #eef0f2;
      border: 1px solid #e3e6ea;
    }
    .lr-music-art-empty {
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      border-radius: 8px;
      background-color: #eef0f2;
      border: 1px solid #e3e6ea;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #98a2ad;
    }

    .lr-music-meta {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
    }
    .lr-music-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #15171a;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lr-music-artist {
      margin: 0;
      font-size: 13px;
      font-weight: 400;
      color: #5f6368;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Thin progress line pinned to the very top edge of the bar. */
    .lr-music-progress-track {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background-color: #eef0f2;
      overflow: hidden;
    }
    .lr-music-progress-fill {
      height: 100%;
      background-color: #0a66c2;
      transition: width 240ms linear;
    }

    /* ----- Round transport / volume controls ----- */
    .lr-music-ctrl {
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      background-color: transparent;
      color: #2e3133;
      border: 1px solid #d6dbe1;
      border-radius: 999px;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    }
    .lr-music-ctrl:hover {
      background-color: #f4f6f8;
      border-color: #c2c8d0;
    }
    .lr-music-ctrl:active { transform: translateY(1px); }
    .lr-music-ctrl:disabled {
      color: #b9bdc4;
      border-color: #e3e6ea;
      cursor: not-allowed;
    }
    .lr-music-ctrl:disabled:hover { background-color: transparent; }

    /* Primary play/pause — filled blue pill, sized up. */
    .lr-music-ctrl--primary {
      width: 40px;
      height: 40px;
      background-color: #0a66c2;
      color: #ffffff;
      border-color: #0a66c2;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-music-ctrl--primary:hover {
      background-color: #084e9c;
      border-color: #084e9c;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-music-ctrl--primary:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
    }

    /* ----- Search overlay (mirrors text-popover conventions) ----- */
    .lr-music-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.32);
      z-index: 220;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: lr-music-fade-in 160ms ease-out;
    }
    .lr-music-popover {
      width: 100%;
      max-width: 100%;
      height: 55vh;
      min-height: 400px;
      max-height: 60vh;
      background-color: #ffffff;
      border: 1px solid #e3e6ea;
      border-radius: 18px;
      box-shadow: 0 16px 40px rgba(15,23,42,0.22);
      padding: 24px 22px 22px;
      display: flex;
      flex-direction: column;
      animation: lr-music-pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .lr-music-close-btn {
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      background-color: transparent;
      color: #d23a2c;
      border: 1px solid #d23a2c;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .lr-music-close-btn:hover {
      background-color: #d23a2c;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-music-close-btn:active { transform: translateY(1px); }

    /* Mode toggle (Songs / Playlists) ----- */
    .lr-music-tab {
      flex: 1 1 0;
      min-width: 0;
      padding: 10px 12px;
      background-color: transparent;
      color: #3c4043;
      border: 1px solid #d6dbe1;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .lr-music-tab:hover { background-color: #f4f6f8; }
    .lr-music-tab[data-active="true"] {
      background-color: #0a66c2;
      color: #ffffff;
      border-color: #0a66c2;
    }

    .lr-music-search-input {
      flex: 1 1 0;
      min-width: 0;
      box-sizing: border-box;
      padding: 12px 14px;
      font-size: 15px;
      line-height: 1.4;
      color: #15171a;
      background-color: #ffffff;
      border: 1px solid #d6dbe1;
      border-radius: 12px;
      outline: none;
      font-family: inherit;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .lr-music-search-input:focus {
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-music-search-input::placeholder {
      color: #2e3133;
      opacity: 1;
    }

    .lr-music-search-submit {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 18px;
      background-color: #0a66c2;
      color: #ffffff;
      border: 1px solid #0a66c2;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    }
    .lr-music-search-submit:hover {
      background-color: #084e9c;
      border-color: #084e9c;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-music-search-submit:active { transform: translateY(1px); }
    .lr-music-search-submit:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ----- Result rows ----- */
    .lr-music-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border: 1px solid #e3e6ea;
      border-radius: 12px;
      background-color: #ffffff;
    }
    .lr-music-row-art {
      width: 46px;
      height: 46px;
      flex-shrink: 0;
      border-radius: 8px;
      object-fit: cover;
      background-color: #eef0f2;
      border: 1px solid #e3e6ea;
    }
    .lr-music-row-meta {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lr-music-row-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #15171a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lr-music-row-sub {
      margin: 0;
      font-size: 13px;
      font-weight: 400;
      color: #5f6368;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lr-music-row-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    /* Small pill actions on result rows (Enqueue / Play / Play All). */
    .lr-music-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    }
    .lr-music-pill:active { transform: translateY(1px); }
    .lr-music-pill:disabled { opacity: 0.6; cursor: default; }
    .lr-music-pill--play {
      background-color: #1f9d55;
      color: #ffffff;
      border: 1px solid #1f9d55;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-music-pill--play:hover:not(:disabled) {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-music-pill--enqueue {
      background-color: transparent;
      color: #0a66c2;
      border: 1px solid #0a66c2;
    }
    .lr-music-pill--enqueue:hover:not(:disabled) {
      background-color: #0a66c2;
      color: #ffffff;
    }

    .lr-music-playlist-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background-color: transparent;
      color: #2e3133;
      border: 1px solid #c2c8d0;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .lr-music-playlist-back:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
    }
  `
  document.head.appendChild(styleEl)
}

// --- Icons ---

function PlayIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}
function PrevIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 5h2v14H6zM20 5v14l-11-7z" />
    </svg>
  )
}
function NextIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16 5h2v14h-2zM4 5l11 7-11 7z" />
    </svg>
  )
}
function VolDownIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon
        points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
        fill="currentColor"
        stroke="none"
      />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  )
}
function VolUpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon
        points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
        fill="currentColor"
        stroke="none"
      />
      <line x1="19" y1="9" x2="19" y2="15" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
function NoteIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M9 17V5l10-2v12"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="17" r="3" />
      <circle cx="16" cy="15" r="3" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

// --- Search overlay ---

type SearchTab = "songs" | "playlists"

// Drill-in state: when the user opens a playlist, we fetch its songs and show
// them with the same song-row affordances (Play / Enqueue). `null` = top-level
// search results; a value = viewing that playlist's contents.
interface PlaylistDrill {
  playlist: MusicPlaylistResult
  songs: MusicSongResult[]
}

type SongSearchResp = {
  ok: boolean
  results?: MusicSongResult[]
  error?: string
}
type PlaylistSearchResp = {
  ok: boolean
  results?: MusicPlaylistResult[]
  error?: string
}
type PlaylistContentsResp = {
  ok: boolean
  results?: MusicSongResult[]
  error?: string
}
type ActionResp = { ok: boolean; error?: string }

function MusicSearchOverlay({ onClose }: { onClose: () => void }) {
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )
  const [tab, setTab] = useState<SearchTab>("songs")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [songResults, setSongResults] = useState<MusicSongResult[]>([])
  const [playlistResults, setPlaylistResults] = useState<MusicPlaylistResult[]>(
    []
  )
  const [drill, setDrill] = useState<PlaylistDrill | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Autofocus the search field on open (popover convention). Because the
  // overlay only closes on an explicit X / Escape — never on blur — a focused
  // or half-typed query can't be destroyed by an incidental side-panel blur.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape closes the overlay. This is the second explicit-close affordance
  // alongside the X button; there is deliberately NO backdrop-click or
  // blur/visibilitychange close path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const runSearch = async () => {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setError(null)
    setDrill(null)
    if (tab === "songs") {
      const resp = await sendToBackground<unknown, SongSearchResp>({
        name: "musicSearch",
        body: { query: q, secret: extensionSecret }
      }).catch(
        (err): SongSearchResp => ({
          ok: false,
          error: err instanceof Error ? err.message : "Network error"
        })
      )
      if (resp?.ok) {
        setSongResults(resp.results ?? [])
      } else {
        setError(resp?.error ?? "Search failed")
      }
    } else {
      const resp = await sendToBackground<unknown, PlaylistSearchResp>({
        name: "musicPlaylistSearch",
        body: { query: q, secret: extensionSecret }
      }).catch(
        (err): PlaylistSearchResp => ({
          ok: false,
          error: err instanceof Error ? err.message : "Network error"
        })
      )
      if (resp?.ok) {
        setPlaylistResults(resp.results ?? [])
      } else {
        setError(resp?.error ?? "Search failed")
      }
    }
    setSearching(false)
  }

  const openPlaylist = async (playlist: MusicPlaylistResult) => {
    setSearching(true)
    setError(null)
    const resp = await sendToBackground<unknown, PlaylistContentsResp>({
      name: "musicPlaylistContents",
      body: { id: playlist.id, secret: extensionSecret }
    }).catch(
      (err): PlaylistContentsResp => ({
        ok: false,
        error: err instanceof Error ? err.message : "Network error"
      })
    )
    if (resp?.ok) {
      setDrill({ playlist, songs: resp.results ?? [] })
    } else {
      setError(resp?.error ?? "Couldn't load playlist")
    }
    setSearching(false)
  }

  // Fire-and-forget song/playlist actions. No optimistic UI — truth arrives
  // over the now-playing WS stream that drives the bar above.
  const enqueueSong = (song: MusicSongResult) => {
    void sendToBackground<unknown, ActionResp>({
      name: "musicEnqueue",
      body: { id: song.id, secret: extensionSecret }
    }).catch(() => {})
  }
  const playSong = (song: MusicSongResult) => {
    void sendToBackground<unknown, ActionResp>({
      name: "musicPlay",
      body: { id: song.id, secret: extensionSecret }
    }).catch(() => {})
  }
  const playPlaylist = (playlist: MusicPlaylistResult) => {
    void sendToBackground<unknown, ActionResp>({
      name: "musicPlaylistPlay",
      body: { id: playlist.id, secret: extensionSecret }
    }).catch(() => {})
  }

  const switchTab = (next: SearchTab) => {
    if (next === tab) return
    setTab(next)
    setError(null)
    setDrill(null)
  }

  // Song rows carry TWO pills (Play + Enqueue); playlist rows carry ONE
  // (Play All) plus a tappable body that drills into the contents.
  const renderSongRow = (song: MusicSongResult) => (
    <div key={song.id} className="lr-music-row">
      {song.artUrl ? (
        <img className="lr-music-row-art" src={song.artUrl} alt="" />
      ) : (
        <div className="lr-music-row-art" />
      )}
      <div className="lr-music-row-meta">
        <p className="lr-music-row-title">{song.title}</p>
        <p className="lr-music-row-sub">
          {song.artists}
          {song.album ? ` · ${song.album}` : ""}
        </p>
      </div>
      <div className="lr-music-row-actions">
        <button
          type="button"
          className="lr-music-pill lr-music-pill--enqueue"
          onClick={() => enqueueSong(song)}
        >
          Queue
        </button>
        <button
          type="button"
          className="lr-music-pill lr-music-pill--play"
          onClick={() => playSong(song)}
        >
          Play
        </button>
      </div>
    </div>
  )

  return (
    <div
      className="lr-music-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Search music"
    >
      <div className="lr-music-popover">
        <header style={overlayStyles.header}>
          <h2 style={overlayStyles.title}>
            {drill ? drill.playlist.title : "Search Music"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="lr-music-close-btn"
            aria-label="Close search"
          >
            <CloseIcon />
          </button>
        </header>

        {drill ? (
          <button
            type="button"
            className="lr-music-playlist-back"
            style={{ alignSelf: "flex-start", marginBottom: "14px" }}
            onClick={() => setDrill(null)}
          >
            <ChevronLeftIcon />
            Back to results
          </button>
        ) : (
          <>
            <div style={overlayStyles.tabRow}>
              <button
                type="button"
                className="lr-music-tab"
                data-active={tab === "songs"}
                onClick={() => switchTab("songs")}
              >
                Songs
              </button>
              <button
                type="button"
                className="lr-music-tab"
                data-active={tab === "playlists"}
                onClick={() => switchTab("playlists")}
              >
                Playlists
              </button>
            </div>
            <form
              style={overlayStyles.searchRow}
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch()
              }}
            >
              <input
                ref={inputRef}
                className="lr-music-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  tab === "songs" ? "Search songs…" : "Search playlists…"
                }
                aria-label="Search query"
              />
              <button
                type="submit"
                className="lr-music-search-submit"
                disabled={searching || !query.trim()}
              >
                {searching ? "…" : "Search"}
              </button>
            </form>
          </>
        )}

        {error && <p style={overlayStyles.error}>{error}</p>}

        <div style={overlayStyles.results}>
          {searching && (
            // Explicit pane-level feedback. The submit button shows "…" too,
            // but a playlist drill-in hides that button entirely, so without
            // this the results pane is a blank void while a fetch is in flight.
            <p style={overlayStyles.empty}>Searching…</p>
          )}
          {searching
            ? null
            : drill
            ? drill.songs.length > 0
              ? drill.songs.map(renderSongRow)
              : (
                  <p style={overlayStyles.empty}>This playlist is empty.</p>
                )
            : tab === "songs"
              ? songResults.length > 0
                ? songResults.map(renderSongRow)
                : (
                    <p style={overlayStyles.empty}>
                      Search for a song to play or queue it.
                    </p>
                  )
              : playlistResults.length > 0
                ? playlistResults.map((pl) => (
                    <div key={pl.id} className="lr-music-row">
                      {pl.artUrl ? (
                        <img
                          className="lr-music-row-art"
                          src={pl.artUrl}
                          alt=""
                        />
                      ) : (
                        <div className="lr-music-row-art" />
                      )}
                      {/* role="button" (not a real <button>) because the meta
                          carries block <p> children — flow content that's
                          invalid inside a <button>'s phrasing-only model. A
                          div + Enter/Space keyboard activation keeps it
                          clickable and accessible without the nesting violation. */}
                      <div
                        className="lr-music-row-meta"
                        role="button"
                        tabIndex={0}
                        style={overlayStyles.playlistOpen}
                        onClick={() => void openPlaylist(pl)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            void openPlaylist(pl)
                          }
                        }}
                        aria-label={`Open ${pl.title}`}
                      >
                        <p className="lr-music-row-title">{pl.title}</p>
                        <p className="lr-music-row-sub">
                          {pl.creator}
                          {pl.trackCount
                            ? ` · ${pl.trackCount} track${pl.trackCount === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </div>
                      <div className="lr-music-row-actions">
                        <button
                          type="button"
                          className="lr-music-pill lr-music-pill--play"
                          onClick={() => playPlaylist(pl)}
                        >
                          Play All
                        </button>
                      </div>
                    </div>
                  ))
                : (
                    <p style={overlayStyles.empty}>
                      Search for a playlist to play it.
                    </p>
                  )}
        </div>
      </div>
    </div>
  )
}

// --- Bar ---

type ControlResp = { ok: boolean; error?: string }

// The transport/volume control handlers the bar fires. A literal union (not a
// bare string) so the message name resolves against Plasmo's MessagesMetadata
// and a typo can't slip a non-existent handler name through.
type ControlName =
  | "musicPrev"
  | "musicNext"
  | "musicPause"
  | "musicResume"
  | "musicVolume"

export function MusicBar() {
  const slot = useContext(MusicRemoteContext)
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )
  // The expanded search overlay's open/closed state is the bar's OWN source of
  // truth — decoupled from `suppressed` so a side-panel blur (which flips
  // suppression) can never tear down a mid-input search. It only closes via
  // the overlay's explicit X / Escape.
  const [searchOpen, setSearchOpen] = useState(false)

  const snapshot = slot?.snapshot ?? null
  const status = slot?.status ?? "idle"
  const suppressed = slot?.suppressed ?? false
  const track = snapshot?.track ?? null
  const hasTrack = !!track

  // The bar paints only when it has a slot, isn't suppressed by a higher
  // overlay, and actually has a track to show. (An idle player with no track
  // shows nothing rather than an empty shell.)
  const barVisible = !!slot && !suppressed && hasTrack

  // The 4Hz progress clock lives HERE, in the bar subtree, not in the
  // orchestrator that owns the WS subscription — so playback re-renders only
  // the bar. Gated on barVisible so a suppressed/empty bar burns no interval,
  // AND on a live (`open`) socket: a dropped connection retains the last
  // snapshot, so without this gate the tick would keep advancing the progress
  // fill past reality during an outage/backoff. Freezing at the last anchor
  // until a fresh frame re-anchors is the honest display when the stream is
  // stale. (Pause already freezes via the anchor's isPlaying flag.)
  const displayPositionMs = useInterpolatedPosition(
    snapshot,
    barVisible && status === "open"
  )

  // CSS-var height seam. It writes BAR_HEIGHT_PX when the bar is painting and
  // 0px otherwise; the cleanup also resets to 0px on unmount so a mode switch
  // can't strand a reserved gap.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(
      BAR_HEIGHT_VAR,
      barVisible ? `${BAR_HEIGHT_PX}px` : "0px"
    )
    return () => {
      root.style.setProperty(BAR_HEIGHT_VAR, "0px")
    }
  }, [barVisible])

  // If the bar stops painting while the overlay is open, the overlay is a
  // standalone fixed layer (z above the bar) and can stay — it persists across
  // mode switches now that the bar is cross-mode chrome (the slot is present on
  // every non-editor surface). A genuine slot-loss (no provider at all — e.g. a
  // future template-editor surface) still drops it, since there's no music
  // surface to return to.
  useEffect(() => {
    if (!slot) setSearchOpen(false)
  }, [slot])

  const isPlaying = snapshot?.isPlaying ?? false
  const positionMs = displayPositionMs
  const durationMs = track?.durationMs ?? 0
  const progressPct =
    durationMs > 0
      ? Math.max(0, Math.min(100, (positionMs / durationMs) * 100))
      : 0

  const sendControl = (name: ControlName, body?: Record<string, unknown>) => {
    void sendToBackground<unknown, ControlResp>({
      name,
      body: { ...body, secret: extensionSecret }
    }).catch(() => {})
  }

  // The returned root is ALWAYS a Fragment whose SECOND child is the search
  // overlay, so the overlay keeps a stable position/identity across every
  // re-render of this instance. Conditionally returning a bare overlay from a
  // `!barVisible` early-return would change the root element type
  // (Fragment → MusicSearchOverlay), which React reconciles as a full
  // unmount+remount — wiping the overlay's half-typed query and results. That
  // is exactly the focus-loss-must-not-destroy-input invariant, and the bar's
  // own paint state (a `track: null` snapshot between songs flips hasTrack, a
  // transient suppression flips `suppressed`) must not tear the overlay down.
  // So we gate ONLY the bar chrome on barVisible and render the overlay
  // independently while a slot exists.
  return (
    <>
      {barVisible && (
        <div className="lr-music-bar" role="region" aria-label="Now playing">
          <div className="lr-music-progress-track" aria-hidden="true">
            <div
              className="lr-music-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {track && track.artUrl ? (
            <img className="lr-music-art" src={track.artUrl} alt="" />
          ) : (
            <div className="lr-music-art-empty">
              <NoteIcon />
            </div>
          )}

          <div className="lr-music-meta">
            <p className="lr-music-title">{track?.title}</p>
            <p className="lr-music-artist">{track?.artists}</p>
          </div>

          <div style={barStyles.controls}>
            <button
              type="button"
              className="lr-music-ctrl"
              onClick={() => sendControl("musicPrev")}
              aria-label="Previous track"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              className="lr-music-ctrl lr-music-ctrl--primary"
              onClick={() =>
                sendControl(isPlaying ? "musicPause" : "musicResume")
              }
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              type="button"
              className="lr-music-ctrl"
              onClick={() => sendControl("musicNext")}
              aria-label="Next track"
            >
              <NextIcon />
            </button>
          </div>

          <div style={barStyles.controls}>
            <button
              type="button"
              className="lr-music-ctrl"
              onClick={() => sendControl("musicVolume", { dir: "down" })}
              aria-label="Volume down"
            >
              <VolDownIcon />
            </button>
            <button
              type="button"
              className="lr-music-ctrl"
              onClick={() => sendControl("musicVolume", { dir: "up" })}
              aria-label="Volume up"
            >
              <VolUpIcon />
            </button>
          </div>

          <button
            type="button"
            className="lr-music-ctrl"
            onClick={() => setSearchOpen(true)}
            aria-label="Search music"
          >
            <SearchIcon />
          </button>
        </div>
      )}

      {slot && searchOpen && (
        <MusicSearchOverlay onClose={() => setSearchOpen(false)} />
      )}
    </>
  )
}

const barStyles: Record<string, React.CSSProperties> = {
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0
  }
}

const overlayStyles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    margin: "0 0 16px 0"
  },
  title: {
    margin: 0,
    fontSize: "19px",
    fontWeight: 700,
    lineHeight: 1.1,
    color: "#15171a",
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  tabRow: {
    display: "flex",
    gap: "10px",
    margin: "0 0 14px 0"
  },
  searchRow: {
    display: "flex",
    alignItems: "stretch",
    gap: "10px",
    margin: "0 0 14px 0"
  },
  error: {
    margin: "0 0 12px 0",
    fontSize: "13px",
    fontWeight: 500,
    color: "#a82a20",
    lineHeight: 1.3
  },
  // The results list is the ONLY scroll child — flex-grow + min-height:0 so
  // the popover stays fixed-height and only this column scrolls.
  results: {
    flex: "1 1 0",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingRight: "2px"
  },
  empty: {
    margin: "8px 0 0 0",
    fontSize: "14px",
    fontWeight: 400,
    color: "#5f6368",
    lineHeight: 1.4
  },
  // Applied to the playlist row's drill-in target (a div role="button"). Just
  // the pointer affordance + top-aligned text; .lr-music-row-meta supplies the
  // flex column layout.
  playlistOpen: {
    cursor: "pointer",
    alignItems: "flex-start"
  }
}
