import {useProducaoEspelho} from '@/hooks/useProducaoEspelho';
import {ProducaoEspelhoView} from '@/components/controle/ProducaoEspelhoPainel';
import '@/components/controle/ProducaoEspelhoPainel.css';
export default function ProducaoFabrica() {
  const query=useProducaoEspelho();
  return <ProducaoEspelhoView data={query.data} autorizado={query.autorizado} identityKey={query.identityKey} loading={query.isPending} fetching={query.isFetching} error={query.isError} atualizar={query.atualizar}/>;
}
