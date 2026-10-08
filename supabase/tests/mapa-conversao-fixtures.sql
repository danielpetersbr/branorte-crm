-- Dados sintéticos para executar a definição real da mv_mapa_conversoes em um
-- Postgres descartável. Não executar INSERTs deste arquivo na base de produção.
insert into orcamentos_gerados values
('2026 - 0001',null,'{"fone":"11999990001","cnpj":"12345678901"}','2026-01-01',100),
('2026 - 0002',null,'{"fone":"+55 11 99999-0001","cnpj":"12345678901"}','2026-02-01',200),
('2026 - 0003',null,'{"fone":"11999990002","cnpj":"12345678902"}','2026-03-01',300),
('2026 - 0004',null,'{"fone":"11999990003","cnpj":"12345678903"}','2026-04-01',400),
('2026 - 0005',null,'{"fone":"11999990004"}','2026-04-01',500),
('2026 - 0006',null,'{"fone":"11999990005"}','2026-04-01',600),
('2026 - 0007',null,'{"fone":"11999990006"}','2026-04-01',700),
('2026 - 0008',null,'{"cnpj":"12345678908"}','2026-04-01',800);
insert into mirror_pedidos_venda values
('p1','XX-2026-0001','Cliente Antigo','São Paulo','SP','{"telefone":"11999990001","cpf_cnpj":"12345678901"}',null,150,'FECHADO'),
('p2',null,'Outro Nome','Rio','RJ','{"cpf_cnpj":"12345678902"}',null,250,'ABERTO'),
('p3',null,'Nome Diferente','Manaus','AM','{"telefone":"+55 11 99999-0003"}',null,350,'FECHADO'),
('p4','2026-0005','Cancelado Teste','São Paulo','SP','{"telefone":"11999990004"}',null,500,'CANCELADO'),
('p5',null,'Nome Completo','Cuiabá','MT','{}',null,450,'FECHADO'),
('p6',null,'Documento Divergente','São Paulo','SP','{"cpf_cnpj":"98765432101"}',null,550,'FECHADO'),
('p7',null,'Telefone Divergente','São Paulo','SP','{"telefone":"11999998888"}',null,650,'FECHADO'),
('p8','2026-0007','Garantia Teste','São Paulo','SP','{"telefone":"11999990006","fonte_origem":"Garantia"}',null,700,'FECHADO');
insert into vendas_mapa values
('v1','p1','2026-0001','Cliente Antigo','São Paulo','SP','11999990001',150),
('v4','p4','2026-0005','Cancelado Teste','São Paulo','SP','11999990004',500),
('v8','p8','2026-0007','Garantia Teste','São Paulo','SP','11999990006',700),
('historico',null,null,'Empresa Histórica','Tubarão','SC','48999990001',1000),
('lid-venda',null,null,'Outro Cliente','Palmas','TO','1177537732',1000);
insert into mv_mapa_orcamentos values
('varios','Cliente Atual','São Paulo','SP','2026 - 0001, 2026 - 0002','11999990001',null,200),
('cpf','Cliente CPF','Fortaleza','CE','2026 - 0003','85999990001',null,300),
('fone','Cliente Telefone','Salvador','BA','2026 - 0004','11999990003',null,400),
('homonimo','Nome Completo','Cuiabá','GO',null,null,null,1),
('outrof','Nome Completo','Goiânia','MT',null,null,null,1),
('nomecidade','Nome Completo','Cuiaba','MT',null,null,null,1),
('cancelado','Cancelado Teste','São Paulo','SP','2026 - 0005','11999990004',null,500),
('historico','Empresa Histórica','Tubarão','SC','venda','48999990001',null,1000),
('lid','LID Teste','Palmas','TO',null,'221727753773286',null,1),
('conflito-doc','Documento Divergente','São Paulo','SP','2026 - 0008',null,null,1),
('conflito-fone','Telefone Divergente','São Paulo','SP','2026 - 0006','11999990005',null,1),
('garantia','Garantia Teste','São Paulo','SP','2026 - 0007','11999990006',null,700);
insert into mv_lista_orcamentos_mapa values
(1,'2026 - 0001','Cliente Atual','São Paulo','SP',100),
(2,'2026 - 0002','Cliente Atual','São Paulo','SP',200);
insert into cliente_dados_visita(id,telefone,nome,cidade,estado) values
('00000000-0000-0000-0000-000000000002','11999990001','Nome WhatsApp','São Paulo','SP');

-- Mesmo cliente agregado no mapa, com telefone alterado no orçamento novo.
insert into orcamentos_gerados values
('2026 - 1000',null,'{"fone":"47999990001"}','2026-01-01',100),
('2026 - 1001',null,'{"fone":"47999990002"}','2026-02-01',200),
('2026 - 1002',null,'{"fone":"91999990001","cnpj":"22222222222"}','2026-03-01',300);
insert into mirror_pedidos_venda values
('p1000','2026-1000','Cliente Mudou Fone','Joinville','SC','{"telefone":"47999990001"}',null,150,'FECHADO'),
('p1002',null,'Outra Pessoa','Belém','PA','{"telefone":"91999990001","cpf_cnpj":"11111111111"}',null,350,'FECHADO');
insert into mv_mapa_orcamentos values
('mudou-fone','Cliente Mudou Fone','Joinville','SC','2026 - 1000, 2026 - 1001','47999990002',null,200),
('fone-compartilhado','CPF Diferente','Belém','PA','2026 - 1002','91999990001',null,300);
insert into mv_lista_orcamentos_mapa values (1001,'2026 - 1001','Cliente Mudou Fone','Joinville','SC',200);
insert into vendas_mapa values ('cancel-null',null,'2026-0005','Cancelado Teste','São Paulo','SP','11999990004',500);
insert into cliente_dados_visita(id,telefone,nome,cidade,estado,vendedor_nome) values
('00000000-0000-0000-0000-000000000003','1177537732','LID Curto','Palmas','TO','ANA');
insert into wa_chat_labels values ('1177537732@lid','ANA','1177537732');

-- A prova da conversão pode existir só no número do orçamento antigo.
insert into orcamentos_gerados values
('2026 - 2000',null,'{}','2026-01-01',100),
('2026 - 2001',null,'{"fone":"85999990007"}','2026-02-01',200);
insert into mirror_pedidos_venda values
('p2000','2026-2000','Nome Venda','Fortaleza','CE','{}',null,150,'FECHADO');
insert into mv_mapa_orcamentos values
('only-number','Nome Atual','Fortaleza','CE','2026 - 2000, 2026 - 2001','85999990007',null,200);
insert into mv_lista_orcamentos_mapa values (2001,'2026 - 2001','Nome Atual','Fortaleza','CE',200);

alter table orcamentos_gerados add cliente_nome text;
alter table orcamentos_legado add cliente_nome text;
insert into orcamentos_gerados values ('2026 - 3000',null,'{"fone":"11999990009"}','2026-01-01',500,'Empresa Histórica LTDA');
insert into vendas_mapa values
('empresa-fixo-antigo',null,null,'Empresa Histórica LTDA','São Paulo','SP','1133334444',650),
('local',null,null,'EmpresaCurta','Tubarão','SC','3466-0724',1000),
('pedido-outro-cliente','p1000','2026-2001','Nome Atual','Fortaleza','CE','85999990007',150);
insert into mv_mapa_orcamentos values ('local','EmpresaCurta','Tubarão','SC','venda','34660724',null,1000);
insert into mv_mapa_orcamentos values ('empresa-antiga','Empresa Nome Atual LTDA','São Paulo','SP','2026 - 3000','11999990009',null,500);
