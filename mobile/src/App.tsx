import { useEffect, useMemo, useState } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"

import {
  SettingsButton,
  SettingsPopover
} from "~/components/settings-popover"
import { getDialpadUserContext } from "~/lib/api"
import { useCallStream } from "~/lib/callStream"
import {
  CallConfigContext,
  CallerIdPickerContext,
  CallStreamContext
} from "~/lib/contexts"
import { storage, useStorage } from "~/lib/storage"
import type { CallConfig, UserContextState } from "~/lib/types"
import { CandidatePager } from "~/screens/candidate-pager"
import { JobsList } from "~/screens/jobs-list"
import { Setup } from "~/screens/setup"

// App entry. Auth-gates the main flow on consultantFirstName +
// extensionSecret, then mounts the persistent contexts (call-stream
// polling, caller-ID picker state, call-config) above the routed views so
// candidate pages share state across navigation.

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

function AppShell() {
  const [name] = useStorage<string>("consultantFirstName", "")
  const [secret] = useStorage<string>("extensionSecret", "")
  const isSetup = name.trim().length > 0 && secret.trim().length > 0

  if (!isSetup) {
    return <Setup />
  }
  return <ConfiguredShell name={name} secret={secret} />
}

function ConfiguredShell({ name, secret }: { name: string; secret: string }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Caller IDs — fetched once when secret resolves, then held for the
  // session. Same shape as the extension's candidate-mode entry.
  const [contextState, setContextState] = useState<UserContextState>({
    status: "loading"
  })
  const [selectedCallerAliasId, setSelectedCallerAliasId] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    setContextState({ status: "loading" })

    getDialpadUserContext({ secret })
      .then((resp) => {
        if (cancelled) return
        if (resp.ok) {
          setContextState({ status: "ready", data: resp.data })
          const def =
            resp.data.callerIds.find((c) => c.isDefault) ??
            resp.data.callerIds[0]
          if (def) setSelectedCallerAliasId(def.aliasId)
        } else {
          setContextState({ status: "error", message: resp.error })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setContextState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load"
        })
      })

    return () => {
      cancelled = true
    }
  }, [secret])

  const callStream = useCallStream()
  const callStreamSlot = useMemo(
    () => ({
      state: callStream.state,
      beginLocalCalling: callStream.beginLocalCalling,
      cancelLocalCalling: callStream.cancelLocalCalling
    }),
    [
      callStream.state,
      callStream.beginLocalCalling,
      callStream.cancelLocalCalling
    ]
  )

  const callerIdSlot = useMemo(
    () => ({
      state: contextState,
      selectedAliasId: selectedCallerAliasId,
      onSelect: setSelectedCallerAliasId
    }),
    [contextState, selectedCallerAliasId]
  )

  const callConfig: CallConfig = {
    callerAliasId: selectedCallerAliasId || undefined
  }

  return (
    <CallStreamContext.Provider value={callStreamSlot}>
      <CallConfigContext.Provider value={callConfig}>
        <CallerIdPickerContext.Provider value={callerIdSlot}>
          <SettingsButton onClick={() => setSettingsOpen(true)} />
          {settingsOpen && (
            <SettingsPopover
              initialName={name}
              initialSecret={secret}
              onSave={(nextName, nextSecret) => {
                storage.set("consultantFirstName", nextName)
                storage.set("extensionSecret", nextSecret)
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route path="/jobs" element={<JobsList />} />
            <Route
              path="/jobs/:jobId/candidate/:index"
              element={<CandidatePager />}
            />
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </CallerIdPickerContext.Provider>
      </CallConfigContext.Provider>
    </CallStreamContext.Provider>
  )
}
