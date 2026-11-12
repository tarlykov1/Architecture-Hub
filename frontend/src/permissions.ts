/** Mirror the API's coarse role grants solely for presentation.
 * Real permissions come from /api/auth/me; the backend remains authoritative.
 */
import type {Section} from './workspaceRoutes'

export type PermissionLayer='business'|'systems'|'infrastructure'|'networks'|'flows'|'diagrams'|'import'|'knowledge'|'incidents'|'views'|'board'
export type Grant='read'|'write'
export type AccessProfile={role:string;permissions?:Partial<Record<PermissionLayer,Grant>>}

const roleGrants:Record<string,Partial<Record<PermissionLayer,Grant>>>={
 admin:{business:'write',systems:'write',infrastructure:'write',networks:'write',flows:'write',diagrams:'write',import:'write',knowledge:'write',incidents:'write',views:'write',board:'write'},
 architect:{business:'write',systems:'write',infrastructure:'write',networks:'read',flows:'write',diagrams:'write',import:'write',knowledge:'write',incidents:'write',views:'write',board:'write'},
 engineer:{systems:'read',infrastructure:'write',networks:'write',flows:'read',diagrams:'read',incidents:'read',views:'read',board:'read'},
 security:{systems:'read',infrastructure:'read',networks:'write',flows:'read',diagrams:'read',views:'read',board:'read'},
 business_owner:{business:'write',systems:'read',diagrams:'read',views:'read'},
 viewer:{systems:'read',business:'read',diagrams:'read',incidents:'read',views:'read',board:'read'},
 // Only used by explicitly unauthenticated localhost development.
 development:{business:'write',systems:'write',infrastructure:'write',networks:'write',flows:'write',diagrams:'write',import:'write',knowledge:'write',incidents:'write',views:'write',board:'write'},
}

const sectionResource:Record<Section,PermissionLayer|null>={
 home:null,systems:'systems',infrastructure:'infrastructure',flows:'flows',
 business:'business',networks:'networks',topology:'networks',incidents:'incidents',knowledge:'knowledge',
}

export function canAccess(profile:AccessProfile|null,tokenReady:boolean,resource:PermissionLayer,mode:Grant='read'):boolean{
 // Existing public-demo interactions remain discoverable, while writes remain
 // blocked by the demo request adapter (no real data is ever sent to API).
 if(!tokenReady)return true
 if(!profile)return false // Wait for /api/auth/me before offering write controls.
 const grant=profile.permissions?.[resource]??roleGrants[profile.role]?.[resource]
 return grant==='write'||(mode==='read'&&grant==='read')
}

export function canOpenSection(profile:AccessProfile|null,tokenReady:boolean,section:Section):boolean{
 const resource=sectionResource[section]
 return resource===null||canAccess(profile,tokenReady,resource,'read')
}

export function sectionWriteLayer(section:Section):PermissionLayer|null{
 return sectionResource[section]
}
