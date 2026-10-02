import type { QuickReply } from './chat-quick-replies'

export interface TeamQuickReply extends QuickReply {updated_at?:string;created_by?:string|null}
export interface ChatTeamSummaryData {
  waiting:number;unassigned:number;overdue:number;resolved_today:number;
  average_response_seconds:number|null;response_samples:number;metrics_since:string|null;
}
export function responseTimeLabel(seconds:number):string {
  if(seconds<60)return 'Menos de 1 min'
  const minutes=Math.floor(seconds/60)
  if(minutes<60)return `${minutes} min`
  const hours=Math.floor(minutes/60),remaining=minutes%60
  return `${hours} h${remaining?` ${remaining} min`:''}`
}
