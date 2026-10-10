import { AnimatePresence } from 'motion/react'
import { useEffect } from 'react'
import { useHotkeys, useMenuBridge } from './hooks'
import { CommandBar } from './components/CommandBar'
import { Detail } from './components/Detail'
import { dotStyles } from './components/Dot'
import { Sheets } from './components/Sheets'
import { StatusBar, DayHeader } from './components/StatusBar'
import { TaskList, Composer } from './components/TaskList'
import { TitleBar, Toast } from './components/TitleBar'
import { TraceSheet } from './components/TraceSheet'
import { useUI, useWorld } from './store'

export default function App(): React.JSX.Element {
  const state = useWorld((s) => s.state)
  const setState = useWorld((s) => s.setState)
  const openId = useUI((s) => s.openId)
  const traceFor = useUI((s) => s.traceFor)

  /* One subscription for the whole app. The main process owns the truth;
     the renderer only draws it. */
  useEffect(() => {
    void window.done.getState().then(setState)
    return window.done.onState(setState)
  }, [setState])

  useHotkeys(state)
  useMenuBridge()

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink-0 text-fg">
      <style>{dotStyles}</style>

      {state ? (
        <>
          <TitleBar state={state} />

          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              <DayHeader state={state} />
              <Composer limits={state.limits} />
              <TaskList state={state} />
            </main>

            <AnimatePresence mode="popLayout" initial={false}>
              {openId && state.tasks.find((t) => t.id === openId) && (
                <Detail key={openId} task={state.tasks.find((t) => t.id === openId)!} state={state} />
              )}
            </AnimatePresence>
          </div>

          <StatusBar state={state} />
          <Sheets state={state} />
          <CommandBar state={state} />
          <Toast />

          <AnimatePresence>
            {traceFor && state.tasks.find((t) => t.id === traceFor) && (
              <TraceSheet
                key={traceFor}
                task={state.tasks.find((t) => t.id === traceFor)!}
                state={state}
                onClose={() => useUI.getState().showTrace(null)}
              />
            )}
          </AnimatePresence>
        </>
      ) : (
        <Booting />
      )}
    </div>
  )
}

function Booting(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-baseline text-[15px] font-medium tracking-[-0.045em] text-fg-4">
        done<span className="ml-[0.09em] inline-block h-[4.5px] w-[4.5px] animate-pulse rounded-full bg-fg-4" />
      </div>
    </div>
  )
}