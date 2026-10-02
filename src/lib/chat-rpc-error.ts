import type { PendingChatSend } from './chat-pending-send'

export class ChatRpcError extends Error {
  readonly code:string|undefined
  readonly details:string|null|undefined
  constructor(error:{message:string;code?:string;details?:string|null}) {
    super(error.message)
    this.name='ChatRpcError';this.code=error.code;this.details=error.details
  }
}
export interface RecoveredChatAttachment {path:string;mime?:string;filename?:string}
// Only this server marker guarantees rollback before the outbox/queue was created.
// Generic SQL, authorization and transport errors must keep the original request.
export function recoverRejectedChatQuote(error:unknown,request:PendingChatSend):{body:string;media:RecoveredChatAttachment|null}|null {
  if(!request.reply_msg_id?.trim()||!(error instanceof ChatRpcError)||error.code!=='P0002'||error.details!=='crm_chat_quote_rejected')return null
  return {body:request.body,media:request.path?{path:request.path,mime:request.mime,filename:request.filename}:null}
}
