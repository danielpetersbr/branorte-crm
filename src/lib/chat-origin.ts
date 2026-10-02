export type ChatOrigin = {
  origin:string|null;
  code:string|null;
  code_source:'message'|'lead'|'ad'|null;
  creative:{name:string|null;headline:string|null;url:string|null}|null;
  ad:{id:string|null;name:string|null;title:string|null;campaign:string|null;adset:string|null;seen_at:string;url:string|null;platform:string|null}|null;
}

export function chatOriginUrl(value:string|null|undefined):string|null {
  const text=value?.trim()
  if(!text||/[\u0000-\u0020\u007f\\]/.test(text))return null
  try {
    const url=new URL(text)
    return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password?url.href:null
  } catch {return null}
}

export function chatOriginDate(value:string|null|undefined):string|null {
  if(!value||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return null
  const calendar=new Date(`${value.slice(0,10)}T00:00:00Z`)
  return Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===value.slice(0,10)?value:null
}
