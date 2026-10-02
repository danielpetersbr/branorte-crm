import {useProducaoEspelho} from '@/hooks/useProducaoEspelho';
import {ProducaoEspelhoView} from '@/components/controle/ProducaoEspelhoPainel';
import {ProducaoEspelhoFichaConectada} from '@/components/controle/ProducaoEspelhoFichaConectada';
import '@/components/controle/ProducaoEspelhoPainel.css';
import '@/components/controle/ProducaoEspelhoFicha.css';
import '@/components/controle/ProducaoEspelhoRecursos.css';
export default function ProducaoFabrica() {
  const query=useProducaoEspelho();
  return <ProducaoEspelhoView data={query.data} autorizado={query.autorizado} identityKey={query.identityKey} loading={query.isPending} fetching={query.isFetching} error={query.isError} atualizar={query.atualizar} renderFicha={(card,close,context)=><ProducaoEspelhoFichaConectada key={card.id+context} card={card} close={close} context={context} autorizado={query.autorizado}/>}/>;
}
