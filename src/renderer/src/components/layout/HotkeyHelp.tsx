import * as React from 'react'
import { Keyboard } from 'lucide-react'
import { prettyCombo, useHotkeyStore } from '@/lib/hotkeys'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlay'

/** Shift+? — lists every shortcut currently registered on screen. */
export function HotkeyHelp() {
  const { registry, helpOpen, setHelpOpen } = useHotkeyStore()

  const groups = React.useMemo(() => {
    const map = new Map<string, { combo: string; description: string }[]>()
    for (const meta of Object.values(registry)) {
      if (!map.has(meta.group)) map.set(meta.group, [])
      map.get(meta.group)!.push({ combo: meta.combo, description: meta.description })
    }
    for (const list of map.values()) list.sort((a, b) => a.description.localeCompare(b.description))
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [registry])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent size="lg" className="max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Shortcuts change with the screen you are on. Press{' '}
            <span className="kbd">Shift</span> <span className="kbd">?</span> any time to see this
            list.
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-6 overflow-y-auto pr-1 sm:grid-cols-2">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              <div className="space-y-1">
                {items.map((i) => (
                  <div
                    key={i.combo}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1 truncate">{i.description}</span>
                    <span className="kbd shrink-0">{prettyCombo(i.combo)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
