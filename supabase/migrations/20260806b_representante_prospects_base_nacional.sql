-- Segunda pesquisa entrando no /mapa-potenciais: a base nacional de 148 candidatos
-- (d:\MEGA BRAIN\Branorte\programa-representantes\BRANORTE-REPRESENTANTES-BASE-NACIONAL.xlsx).
-- 28 empresas já estavam nos 54 do mapeamento 2/UF — casadas por nome normalizado
-- + UF ou por telefone (só dígitos) — e entraram uma vez só. Sobraram 120 novos.
--
-- ⚠️ As duas pesquisas NÃO usam a mesma régua:
--   'planilha-54' → prioridade Alta/Média/Exploratória · bruta máx. 10
--                   (fit 0-4 + carteira 0-2 + contato 0-2 + presença 0-2)
--   'base-148'    → prioridade A/B/C/D              · bruta máx. 13
--                   (fit 0-4 + carteira 0-3 + contato 0-2 + presença 0-2 + estrutura 0-2)
-- Por isso 'prioridade' guarda a versão HARMONIZADA (A→Alta, B/C→Média, D→Exploratória),
-- que é a que a legenda do mapa pinta; 'prioridade_origem' guarda o rótulo cru; e
-- 'pontuacao_max' impede a tela de escrever "9/13" para quem foi medido até 10.
alter table public.representante_prospects
  add column if not exists fonte_base        text not null default 'planilha-54',
  add column if not exists pontuacao_max     smallint,
  add column if not exists prioridade_origem text,
  add column if not exists cargo             text,
  add column if not exists whatsapp          text,
  add column if not exists social            text,
  add column if not exists regiao_atendida   text,
  add column if not exists indicio_carteira  text,
  add column if not exists nivel_verificacao text,
  add column if not exists estrutura         smallint;

create index if not exists idx_rep_prospects_fonte on public.representante_prospects (fonte_base);

update public.representante_prospects
   set pontuacao_max = 10,
       prioridade_origem = coalesce(prioridade_origem, prioridade)
 where fonte_base = 'planilha-54' and pontuacao_max is null;

-- Os 120 registros da base-148 são carga de dados (script no scratchpad da sessão:
-- prep148.py → geo148.py → carregar148.py, via REST com service_role), não DDL.
-- 70 têm cidade publicada (geo_precisao='cidade', centroide da malha IBGE) e
-- 50 NÃO têm: nesses o pino vai pro centro do estado com geo_precisao='uf' e a
-- tela desenha um losango vazado, nunca uma gota — a forma tem que denunciar que
-- ali não há endereço apurado. Nada foi inferido para preencher cidade.
