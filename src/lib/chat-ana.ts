export interface ChatAnaMetadata {
  ana_tags?:string[]
  resolution_source?:'ana'|'crm'|null
  resolution_reason?:string|null
  resolved_at?:string|null
  resolution_observed_at?:string|null
}
export function anaTagNames(tags:readonly string[]|undefined):string[] {
  return [...new Set((tags??[]).filter(tag=>typeof tag==='string'&&!!tag.trim()))]
}
const reliableDate=(value:string|null|undefined):string|null=>value&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?value:null
export function chatResolution(conversation:(ChatAnaMetadata&{status:'open'|'resolved'})|undefined) {
  if(conversation?.status!=='resolved')return null
  const known=conversation.resolution_source==='ana'||conversation.resolution_source==='crm'
  return {
    label:conversation.resolution_source==='ana'?'Finalizado pela Ana':conversation.resolution_source==='crm'?'Finalizado no CRM':'Finalizado (origem desconhecida)',
    reason:known?conversation.resolution_reason?.trim()||null:null,
    closedAt:known?reliableDate(conversation.resolved_at):null,
    closedLabel:conversation.resolution_source==='ana'?'Encerramento detectado em':'Finalizado em',
    observedAt:conversation.resolution_source==='ana'?reliableDate(conversation.resolution_observed_at):null,
  }
}
