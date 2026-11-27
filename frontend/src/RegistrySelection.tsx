import type { ReactNode } from 'react'

export function RegistrySelection({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return <aside className="registrySelection" aria-label={'Карточка: ' + title}>
    <header><h3>{title}</h3><button type="button" aria-label="Закрыть карточку" onClick={onClose}>×</button></header>
    {children}
  </aside>
}
