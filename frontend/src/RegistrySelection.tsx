import { useEffect, useRef, type ReactNode } from 'react'

export function RegistrySelection({ kind, title, onClose, children }: {
  kind: string
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const active = document.activeElement
    const selectedRow = panel.current?.closest('.registrySplit')?.querySelector<HTMLElement>('tr.inspectedRow button')
    if (selectedRow) opener.current = selectedRow
    else if (active instanceof HTMLElement && !panel.current?.contains(active)) opener.current = active
    panel.current?.focus({ preventScroll: true })
  }, [title])
  function close() {
    onClose()
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
  }
  return <aside ref={panel} tabIndex={-1} className="registrySelection" aria-label={'Карточка: ' + title}
    onKeyDown={event => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.stopPropagation()
        close()
      }
    }}>
    <header><div><small className="panelKind">{kind}</small><h3>{title}</h3></div>
      <button type="button" aria-label="Закрыть карточку" onClick={close}>Закрыть ×</button>
    </header>
    {children}
  </aside>
}
