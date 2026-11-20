import {useState, type CSSProperties} from 'react'
import {ArrowDown, ArrowUp} from 'lucide-react'
import {workspaceRouteUrl} from './workspaceRoutes'
import type {OverviewFlow} from './OverviewFlowEdge'
import './flowSequence.css'

export type SystemExchange = {source: string; target: string; flow: OverviewFlow}
type Settings = {order: string[]; replies: string[]}
const storageKey = 'archhub-flow-sequence-v1'

function readSettings(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}')
    const ids = (list: unknown): string[] => Array.isArray(list) ? list.filter(id => typeof id === 'string') : []
    return {order: ids(value.order), replies: ids(value.replies)}
  } catch { return {order: [], replies: []} }
}

export function FlowSequence({exchanges, systems, visible}: {
  exchanges: SystemExchange[]
  systems: {id: string; name: string}[]
  visible: Set<string>
}) {
  const [settings, setSettings] = useState(readSettings)
  const [editing, setEditing] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const ranks = new Map(settings.order.map((id, i) => [id, i]))
  const ordered = [...exchanges].sort((a, b) =>
    (ranks.get(a.flow.id) ?? Infinity) - (ranks.get(b.flow.id) ?? Infinity)
    || a.flow.name.localeCompare(b.flow.name, 'ru') || a.flow.id.localeCompare(b.flow.id))
  const rows = ordered.filter(row => visible.has(row.source) || visible.has(row.target))
  const involved = new Set(rows.flatMap(row => [row.source, row.target]))
  const participants = systems.filter(system => involved.has(system.id)).map(system => system.id)
  const lanes = new Map(participants.map((id, index) => [id, index]))
  const names = new Map(systems.map(s => [s.id, s.name]))
  const save = (next: Settings) => {
    setSettings(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false) }
    catch { setStorageError(true) }
  }
  const move = (index: number, offset: number) => {
    const order = ordered.map(row => row.flow.id)
    const a = order.indexOf(rows[index].flow.id), b = order.indexOf(rows[index + offset].flow.id)
    const moving = order[a]
    order[a] = order[b]
    order[b] = moving
    save({...settings, order})
  }
  if (!rows.length) return <div className="sequenceEmpty" role="status">Для выбранных систем нет зарегистрированных потоков.</div>
  return <section className="flowSequence" aria-label="Диаграмма последовательности">
    <div className="sequenceTools">
      <span>{settings.order.length ? 'Порядок шагов задан в этом браузере' : 'Потоки по названию · порядок шагов не задан'}</span>
      <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Готово' : 'Настроить шаги'}</button>
      {storageError && <span role="status">Настройки доступны до закрытия страницы.</span>}
    </div>
    <div className="sequenceScroll" tabIndex={0} role="region" aria-label="Участники и шаги обмена">
      <div className="sequenceSheet" style={{'--lanes': participants.length} as CSSProperties}>
        <div className="sequenceHead">{participants.map(id => <strong key={id}>{names.get(id)}</strong>)}</div>
        <ol className="sequenceSteps">{rows.map(({source, target, flow}, index) => {
          const start = lanes.get(source)!, end = lanes.get(target)!
          const same = start === end, reply = settings.replies.includes(flow.id)
          const label = flow.name || flow.data_description || 'Поток данных'
          return <li key={flow.id} className="sequenceRow">
            <div className={'sequenceMessage' + (start > end ? ' backwards' : '') + (same ? ' self' : '') + (reply ? ' reply' : '')}
              style={{gridColumn: (Math.min(start, end) * 2 + 2) + ' / span ' + (same ? 1 : 2 * Math.abs(start - end))}}>
              <a href={workspaceRouteUrl('flows', '', '', false, flow.id)}
                aria-label={`${index+1}. ${label}. ${names.get(source)} → ${names.get(target)}${reply ? '. Ответ' : ''}`}>
                <span>{index+1}.</span> {label}
              </a>
              <div className="sequenceArrow" aria-hidden="true"/>
              {editing && <div className="sequenceActions">
                <button type="button" aria-label={'Поднять шаг '+label} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={15}/></button>
                <button type="button" aria-label={'Опустить шаг '+label} disabled={index===rows.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></button>
                <label><input type="checkbox" checked={reply} onChange={()=>save({...settings,replies:reply ? settings.replies.filter(id=>id!==flow.id) : [...settings.replies,flow.id]})}/> Ответ</label>
              </div>}
            </div>
          </li>
        })}</ol>
      </div>
    </div>
  </section>
}
