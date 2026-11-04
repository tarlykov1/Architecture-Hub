/**
 * One canonical browser URL per architecture workspace.
 * Preserve only meaningful entity context; transient filters remain local UI state.
 */
export const SECTION_PATHS = {
  home: '/',
  systems: '/systems',
  infrastructure: '/components',
  flows: '/flows',
  business: '/business',
  networks: '/networks',
  topology: '/topology',
  incidents: '/incidents',
  knowledge: '/knowledge',
} as const

export type Section = keyof typeof SECTION_PATHS
export type WorkspaceRoute = {layer: Section; systemId: string}

const PATH_SECTIONS = Object.fromEntries(
  Object.entries(SECTION_PATHS).map(([section, path]) => [path, section])
) as Record<string, Section>

export function parseWorkspaceRoute(location: Pick<Location, 'pathname' | 'search'>): WorkspaceRoute {
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  const layer = PATH_SECTIONS[pathname] ?? 'home'
  const params = new URLSearchParams(location.search)
  // A system filter is meaningful only on the components/flows workspaces.
  const systemId = layer === 'infrastructure' || layer === 'flows'
    ? (params.get('system') || '')
    : ''
  return {layer, systemId}
}

export function workspaceRouteUrl(layer: Section, systemId = ''): string {
  const path = SECTION_PATHS[layer]
  if ((layer !== 'infrastructure' && layer !== 'flows') || !systemId) return path
  return path + '?system=' + encodeURIComponent(systemId)
}
