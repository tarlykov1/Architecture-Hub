import {useState} from 'react'

declare const __BUILD_REVISION__: string
type Versions = {
  api_revision: string | null
  database_heads: string[]
  expected_heads: string[]
}
type Props = {request: <T>(url: string, init?: RequestInit) => Promise<T>}

export default function RuntimeVersion({request}: Props) {
  const [versions, setVersions] = useState<Versions | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  async function load() {
    setBusy(true)
    setFailed(false)
    try {
      setVersions(await request<Versions>('/api/auth/runtime-version', {cache: 'no-store'}))
    } catch {
      setVersions(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const uiRevision = __BUILD_REVISION__
  return <details onToggle={event => {
    if (event.currentTarget.open && !versions && !busy) void load()
  }}>
    <summary>Версии приложения и базы</summary>
    <p>Интерфейс · <code>{uiRevision}</code></p>
    {busy && <p role="status">Проверяем версии…</p>}
    {failed && <p role="status">Сведения о версии API недоступны.</p>}
    {versions && <>
      <p>API · <code>{versions.api_revision || 'Версия не указана'}</code></p>
      {versions.api_revision && uiRevision !== 'unknown' && uiRevision !== versions.api_revision &&
        <p role="status">Интерфейс и API собраны из разных коммитов.</p>}
      <p>Ревизия базы · <code>{versions.database_heads.join(', ') || 'Отметка Alembic отсутствует'}</code></p>
      <p>Ожидаемая ревизия · <code>{versions.expected_heads.join(', ') || 'Не определена'}</code></p>
      {versions.database_heads.length > 0 && versions.expected_heads.length > 0 &&
        <p>{versions.database_heads.join(',') === versions.expected_heads.join(',')
          ? 'Ревизия базы соответствует сборке API.' : 'Ревизия базы отличается от ожидаемой.'}</p>}
    </>}
    <button type="button" disabled={busy} onClick={() => void load()}>Обновить сведения</button>
  </details>
}
