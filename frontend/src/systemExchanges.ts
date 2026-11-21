/** Project technical flows onto the system boundary. Never mix internal VM
 * traffic into the inter-system overview or its sequence diagram. */
export type ExchangeComponent = {id:string;system_id:string;name:string}
export type ExchangeFlow = {id:string;source_id:string;target_id:string;name:string;data_description:string}

export type InterSystemExchange<T extends ExchangeFlow> = {source:string;target:string;flow:T}

/** Unresolved endpoints are not evidence of a connection between two IS. */
export function interSystemExchanges<T extends ExchangeFlow>(
  flows:T[], components:ExchangeComponent[], knownSystemIds?:Set<string>
):InterSystemExchange<T>[] {
  const byComponent=new Map(components.map(component=>[component.id,component]))
  return flows.flatMap(flow=>{
    const source=byComponent.get(flow.source_id)?.system_id
    const target=byComponent.get(flow.target_id)?.system_id
    if(!source||!target||source===target||(
      knownSystemIds&&(!knownSystemIds.has(source)||!knownSystemIds.has(target))
    ))return []
    return [{source,target,flow}]
  })
}

/** A shared map must describe the exchange, not the names of its VM endpoints.
 * Technical endpoints and exact names remain intact in the flow registry.
 */
export function overviewExchangeLabel(flow:ExchangeFlow, components:ExchangeComponent[]):string {
  const endpoints=new Set([flow.source_id,flow.target_id])
  const names=components.filter(component=>endpoints.has(component.id))
    .map(component=>component.name.trim().toLocaleLowerCase('ru-RU')).filter(Boolean)
  const containsEndpoint=(caption:string)=>{
    const lower=caption.toLocaleLowerCase('ru-RU')
    return names.some(name=>lower.includes(name))
  }
  const label=flow.name.trim()
  if(label&&!containsEndpoint(label))return label
  const description=flow.data_description.trim()
  if(description&&!containsEndpoint(description))return description
  return 'Обмен данными'
}
