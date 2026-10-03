import {useProducaoEspelho} from '@/hooks/useProducaoEspelho';
import {ProducaoEspelhoView,ProducaoEspelhoIndicadores} from '@/components/controle/ProducaoEspelhoPainel';
import {ProducaoEspelhoFichaConectada} from '@/components/controle/ProducaoEspelhoFichaConectada';
import '@/components/controle/ProducaoEspelhoPainel.css';
import '@/components/controle/ProducaoEspelhoFicha.css';
import '@/components/controle/ProducaoEspelhoRecursos.css';
function AuditoriaProducao(){
  const query=useProducaoEspelho();
  if(!query.autorizado)return null;
  if(query.isError)return <div role="alert"><p>Não foi possível consultar os indicadores detalhados.</p><button type="button" onClick={query.atualizar} disabled={query.isFetching}>Tentar novamente</button></div>;
  if(!query.data||query.data.parcial)return <p role="status">Consultando indicadores detalhados…</p>;
  return <ProducaoEspelhoIndicadores data={query.data}/>;
}
export default function ProducaoFabrica() {
  const query=useProducaoEspelho('quadro-v1');
  return <ProducaoEspelhoView data={query.data} autorizado={query.autorizado} identityKey={query.identityKey} loading={query.isPending} fetching={query.isFetching} error={query.isError} atualizar={query.atualizar} renderAuditoria={context=><AuditoriaProducao key={context}/>} renderFicha={(card,close,context)=><ProducaoEspelhoFichaConectada key={card.id+context} card={card} close={close} context={context} autorizado={query.autorizado}/>}/>;
}
