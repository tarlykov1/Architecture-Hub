/** Snapshot of an Architecture Hub decision for offline review.
 * A generated document is not itself a registered infrastructure change.
 */
export type DecisionDocument={
  id:string
  title:string
  description:string
  revision:number
  status:string
  base_changed:boolean
  required_services:string[]
  approvals?:Array<{service:string;verdict:string;actor_name?:string;actor?:string;note?:string}>
  proposed_vms:Array<{id:string;name:string;kind:string;x:number;y:number;description?:string;environment?:string}>
  existing_changes?:Array<{
    id:string;kind:'vm'|'flow';action:'update'|'remove'
    fields:Record<string,string>;before:Record<string,string>;after:Record<string,string>|null;impacts?:string[]
  }>
  proposed_flows:Array<{
    id:string;name:string;source_id:string;target_id:string;protocol?:string;port?:string
    data_description?:string;security?:string;schedule?:string;verification?:string
  }>
  comments?:Array<{actor_name?:string;actor?:string;anchor_kind?:string;body:string}>
}
const serviceNames:Record<string,string>={architect:'Архитектура',engineer:'Инфраструктура',security:'Информационная безопасность',business_owner:'Владелец бизнес-процесса'}
const statuses:Record<string,string>={draft:'Черновик',in_review:'На согласовании',changes_requested:'На доработке',approved:'Согласовано',published:'Опубликовано'}
const value=(text?:string)=>text?.trim()||'Не указано'
const cell=(text:string)=>text.replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ')
export function buildTechnicalDecisionMarkdown(decision:DecisionDocument,systemName:string,components:ReadonlyArray<{id:string;name:string}>):string{
  const names=new Map(components.map(item=>[item.id,item.name]))
  for(const vm of decision.proposed_vms)names.set(vm.id,vm.name)
  const rows=[
    '# '+decision.title,
    '',
    '- Идентификатор: `'+decision.id+'`',
    '- Система: '+value(systemName),
    '- Версия: '+decision.revision,
    '- Статус: '+(statuses[decision.status]||decision.status),
    '- Проверка исходной архитектуры: '+(decision.base_changed?'Обнаружены изменения, требуется повторная проверка':'Расхождения не обнаружены на момент формирования'),
    '',
    '## Назначение',
    '',
    value(decision.description),
    '',
    '## Проектируемые ВМ и серверы',
    '',
    '| Объект | Тип | Среда | Описание | Положение на схеме |',
    '| --- | --- | --- | --- | --- |',
  ]
  for(const vm of decision.proposed_vms)rows.push(
    '| '+cell(vm.name)+' | '+cell(vm.kind)+' | '+cell(value(vm.environment))+' | '+cell(value(vm.description))+
    ' | '+Math.round(vm.x)+', '+Math.round(vm.y)+' |'
  )
  if(!decision.proposed_vms.length)rows.push('| Нет проектируемых объектов | — | — | — | — |')
  rows.push('','## Проектируемые потоки','','| Поток | Источник → получатель | Протокол / порт | Данные | Защита | Периодичность | Достоверность |',
    '| --- | --- | --- | --- | --- | --- | --- |')
  for(const flow of decision.proposed_flows)rows.push(
    '| '+cell(flow.name)+' | '+cell(value(names.get(flow.source_id))+' → '+value(names.get(flow.target_id)))+
    ' | '+cell([flow.protocol,flow.port].filter(Boolean).join(':')||'Не указано')+
    ' | '+cell(value(flow.data_description))+' | '+cell(value(flow.security))+
    ' | '+cell(value(flow.schedule))+' | '+cell(value(flow.verification))+' |'
  )
  if(!decision.proposed_flows.length)rows.push('| Нет проектируемых потоков | — | — | — | — | — | — |')
  rows.push('','## Изменение действующей архитектуры','','| Объект | Действие | Параметр | Было | Планируется |',
    '| --- | --- | --- | --- | --- |')
  for(const change of decision.existing_changes||[]){
    const state=change.action==='remove'?'Запланировано удаление':'Изменение'
    const keys=change.action==='remove'?Object.keys(change.before):Object.keys(change.fields)
    for(const key of keys)rows.push(
      '| '+cell(change.before.name||change.id)+' (`'+change.id+'`)'+' | '+
      state+' | '+cell(key)+' | '+cell(change.before[key]||'—')+
      ' | '+cell(change.after?.[key]||'—')+' |'
    )
  }
  if(!decision.existing_changes?.length)rows.push('| Изменения действующих объектов не запланированы | — | — | — | — |')
  rows.push('','### Зависимости затронутых объектов','')
  const affected=[...new Set((decision.existing_changes||[]).flatMap(item=>item.impacts||[]))].sort()
  if(affected.length)for(const dependency of affected)rows.push('- '+dependency)
  else rows.push('Связи с бизнес-процессами и сценариями обмена в реестре не обнаружены.')
  rows.push('','## Маршрут согласования','','| Служба | Решение | Сотрудник | Замечание |',
    '| --- | --- | --- | --- |')
  for(const service of decision.required_services){
    const review=decision.approvals?.find(item=>item.service===service)
    rows.push('| '+cell(serviceNames[service]||service)+' | '+
      cell(review?.verdict==='approved'?'Согласовано':review?.verdict==='changes_requested'?'На доработку':'Ожидается')+
      ' | '+cell(value(review?.actor_name||review?.actor))+' | '+cell(value(review?.note))+' |')
  }
  rows.push('','## Замечания','','')
  if(!decision.comments?.length)rows.push('Замечаний нет.')
  else for(const comment of decision.comments)rows.push(
    '- **'+value(comment.actor_name||comment.actor)+'**'+(comment.anchor_kind&&comment.anchor_kind!=='decision'?' ('+comment.anchor_kind+')':'')+': '+comment.body.replace(/[\r\n]+/g,' ')
  )
  rows.push('','---','', '*Автоматическая выгрузка из Architecture Hub, версия '+decision.revision+'. Не подтверждает фактическое внедрение инфраструктурных изменений.*','')
  return rows.join('\n')
}
