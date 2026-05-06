import { CallStatsBadge } from "~components/call-stats-badge"
import { SettingsButton } from "~components/settings-popover"

// Persistent top-row across every mode (sync / candidate / test_call). The
// daily-call badge and settings gear used to be fixed-positioned overlays
// at top-left/top-right; they sat on top of mode content and clipped the
// identity card and sync header. Putting them in document flow reserves a
// header row so each mode's content starts below — same persistence,
// without the overlap.

export function HeaderBar({
  daily,
  onSettingsClick
}: {
  daily: number | null
  onSettingsClick: () => void
}) {
  return (
    <div style={headerStyles.bar}>
      <CallStatsBadge daily={daily} />
      <SettingsButton onClick={onSettingsClick} />
    </div>
  )
}

const headerStyles: Record<string, React.CSSProperties> = {
  bar: {
    width: "100%",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexShrink: 0
  }
}
