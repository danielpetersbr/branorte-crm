export const CHAVE_PRODUCAO_FABRICA='menu.producao_fabrica';
export type EstadoPermissoesFabrica={userId:string|null;profileId:string|null;role:string|null;approvedAt:string|null;authLoading:boolean;profileError:boolean;permissionsUserId:string|null;loading:boolean;error:boolean;papel:unknown;override:unknown};
const known=(role:string|null)=>['admin','financeiro','vendor','mapa','marketing','visualizador'].includes(role??'');
const approved=(s:EstadoPermissoesFabrica)=>!!s.userId&&s.profileId===s.userId&&!!s.approvedAt&&known(s.role);
export function permissaoProducaoFabrica(s:EstadoPermissoesFabrica){return approved(s)&&!s.authLoading&&!s.profileError&&!s.loading&&!s.error&&s.permissionsUserId===s.userId&&(s.override===undefined?s.papel===true:s.override===true);}
export function decidirRotaProducaoFabrica(path:string,s:EstadoPermissoesFabrica):'unrelated'|'loading'|'error'|'allow'|'deny' {
  try {path=path.split('/').map(segment=>decodeURIComponent(segment).replace(/\//g,'%2F')).join('/');}catch{/* Router retains malformed segments. */}
  if(path.toLowerCase().replace(/\/+$/,'')!=='/controle/producao/fabrica')return 'unrelated';
  if(s.authLoading)return 'loading';
  if(!approved(s))return 'deny';
  if(s.profileError||s.error)return 'error';
  if(s.loading||s.permissionsUserId!==s.userId)return 'loading';
  return permissaoProducaoFabrica(s)?'allow':'deny';
}
export function canComExcecaoFabrica(key:string,state:EstadoPermissoesFabrica,legacy:()=>boolean){return key===CHAVE_PRODUCAO_FABRICA?permissaoProducaoFabrica(state):legacy();}
