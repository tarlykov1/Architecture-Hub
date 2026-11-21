import type {Passport} from './BusinessProcessPassport'

type Named={id:string;name:string}
type Infra=Named&{system_id:string}
type Flow=Named&{source_id:string;target_id:string;protocol?:string;port?:string}
type Attr=Named&{code:string;sensitivity?:string}

function cell(value?:string|null){return (value||'Не указано').replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|')}
const state:Record<Passport['status'],string>={draft:'Черновик',active:'Действует',retired:'Выведен'}

export function buildBusinessProcessMarkdown(
 process:Passport,
 processes:ReadonlyArray<Named>,
 systems:ReadonlyArray<Named>,
 components:ReadonlyArray<Infra>,
 flows:ReadonlyArray<Flow>,
 attributes:ReadonlyArray<Attr>
):string{
 const processNames=new Map(processes.map(item=>[item.id,item.name]))
 const systemNames=new Map(systems.map(item=>[item.id,item.name]))
 const componentNames=new Map(components.map(item=>[item.id,item.name]))
 const flowNames=new Map(flows.map(item=>[item.id,item.name]))
 const attributeNames=new Map(attributes.map(item=>[item.id,item.code+' · '+item.name]))
 const rows=[
  '# '+process.name,
  '',
  '- Идентификатор: `'+process.process_id+'`',
  '- Версия паспорта: '+process.revision,
  '- Состояние: '+state[process.status],
  '- Родительский процесс: '+cell(process.parent_id?processNames.get(process.parent_id):'Корневой процесс'),
  '- Владелец: '+cell(process.owner),
  '- Участники: '+cell(process.participants),
  '- Ожидаемый результат: '+cell(process.result),
  '',
  '## Описание',
  '',
  process.description||'Описание пока не заполнено.',
  '',
  '## Шаги процесса',
  '',
  '| № | Шаг | Ответственный | Вход | Выход | ИС | Компонент | Поток |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
 ]
 for(const [index,step] of process.steps.entries()){
  rows.push('| '+(index+1)+' | '+cell(step.name)+' | '+cell(step.responsible)+' | '+cell(step.input)+
   ' | '+cell(step.output)+' | '+cell(step.system_id?systemNames.get(step.system_id):null)+
   ' | '+cell(step.component_id?componentNames.get(step.component_id):null)+
   ' | '+cell(step.flow_id?flowNames.get(step.flow_id):null)+' |')
 }
 if(!process.steps.length)rows.push('| — | Шагов пока нет | — | — | — | — | — | — |')
 rows.push('','## Технические ссылки по шагам','')
 for(const [index,step] of process.steps.entries()){
  rows.push('### '+(index+1)+'. '+step.name,'')
  if(step.description)rows.push(step.description,'')
  if(step.flow_id){
   const flow=flows.find(f=>f.id===step.flow_id)
   rows.push('- Поток: '+cell(flow?.name)+' (`'+step.flow_id+'`)')
   if(flow)rows.push('- Источник → получатель: '+cell(componentNames.get(flow.source_id))+
    ' → '+cell(componentNames.get(flow.target_id)), '- Протокол / порт: '+cell([flow.protocol,flow.port].filter(Boolean).join(':')))
  }
  if(step.attribute_ids.length)rows.push('- Атрибуты данных: '+step.attribute_ids.map(id=>
   cell(attributeNames.get(id))+' (`'+id+'`)').join('; '))
  if(!step.flow_id&&!step.attribute_ids.length)rows.push('- Технические потоки и атрибуты не указаны.')
  rows.push('')
 }
 rows.push('---','','*Документ сформирован из Architecture Hub. Схема процесса описывает зарегистрированную модель и сама по себе не подтверждает фактическое прохождение трафика или выполнение действий.*','')
 return rows.join('\n')
}
