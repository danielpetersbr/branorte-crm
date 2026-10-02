export type ChatCloseReason={id:string;name:string}

export function chatCloseReason(reasons:readonly ChatCloseReason[]|undefined,id:string):ChatCloseReason|null {
  if(!id.trim())return null
  const matches=(reasons??[]).filter(reason=>reason.id===id)
  return matches.length===1?matches[0]:null
}

export class ChatCloseContext {
  private identity:{conversationId:string;userIdentity:string;open:boolean}|null=null
  private generation=0
  update(conversationId:string,userIdentity:string,open:boolean):number {
    if(!this.identity||this.identity.conversationId!==conversationId||this.identity.userIdentity!==userIdentity||this.identity.open!==open){
      this.identity={conversationId,userIdentity,open};this.generation++
    }
    return this.generation
  }
  isCurrent(generation:number):boolean {return !!this.identity?.open&&generation===this.generation}
}
