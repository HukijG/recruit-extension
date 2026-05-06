// Daily-calls badge — pill that lives inside HeaderBar at the top of every
// sidepanel mode (sync, candidate, test_call) so the consultant always
// sees their running count. Used to be a fixed-position overlay; now it
// sizes/positions via the header's flex layout.

const STATS_BADGE_STYLE_ATTR = "data-lr-stats-badge-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${STATS_BADGE_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(STATS_BADGE_STYLE_ATTR, "")
  styleEl.textContent = `
    .lr-stats-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 11px;
      background-color: #ffffff;
      color: #15171a;
      border: 1px solid #c2c8d0;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 1px 2px rgba(15,23,42,0.06);
      cursor: default;
      user-select: none;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
    }
    .lr-stats-badge-icon {
      flex-shrink: 0;
      color: #0a66c2;
    }
    .lr-stats-badge-count {
      min-width: 0;
    }
    .lr-stats-badge-label {
      font-size: 11px;
      font-weight: 700;
      color: #5f6368;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  `
  document.head.appendChild(styleEl)
}

const RECEIVER_PATH =
  "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"

function PhoneIcon() {
  return (
    <svg
      className="lr-stats-badge-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d={RECEIVER_PATH} />
    </svg>
  )
}

export function CallStatsBadge({ daily }: { daily: number | null }) {
  // null → loading or never-fetched. Show an em-dash so layout is stable
  // and the absence is visibly distinct from a true zero.
  const display = daily === null ? "—" : daily
  return (
    <div
      className="lr-stats-badge"
      title="Calls made today (UTC day)"
      role="status"
      aria-label={
        daily === null
          ? "Daily calls — loading"
          : `${daily} call${daily === 1 ? "" : "s"} today`
      }>
      <PhoneIcon />
      <span className="lr-stats-badge-count">{display}</span>
      <span className="lr-stats-badge-label">today</span>
    </div>
  )
}
