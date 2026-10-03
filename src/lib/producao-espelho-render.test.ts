import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as consulta from './producao-espelho-consulta';
import * as quadro from './producao-espelho-quadro';

// Execute the actual parent component/callbacks without a browser, Auth or API.
// Hooks retain cells across renders; selectors and selection helpers stay real.
function mountCatalogo(){
  const path=process.env.PRODUCAO_BOARD_TEST_SOURCE??new URL('../components/controle/ProducaoEspelhoPainel.tsx',import.meta.url);
  const raw=fs.readFileSync(path,'utf8'),ast=ts.createSourceFile('panel.tsx',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Catalogo');assert.ok(node);
  let cursor=0;const cells:unknown[]=[],counts={filter:0,groups:0,vendors:0};
  const useState=(initial:unknown)=>{const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],(next:unknown)=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];};
  const useRef=(initial:unknown)=>{const index=cursor++;if(!(index in cells))cells[index]={current:initial};return cells[index];};
  const useMemo=(create:()=>unknown,deps:unknown[])=>{const index=cursor++,old=cells[index] as {deps:unknown[];value:unknown}|undefined;if(!old||old.deps.length!==deps.length||deps.some((d,i)=>!Object.is(d,old.deps[i])))cells[index]={deps:[...deps],value:create()};return (cells[index] as {value:unknown}).value;};
  const context={React,Date,useState,useRef,useMemo,useCallback:(fn:unknown,deps:unknown[])=>useMemo(()=>fn,deps),...consulta,...quadro,
    consultarQuadro:(...args:Parameters<typeof quadro.consultarQuadro>)=>{counts.filter++;return quadro.consultarQuadro(...args);},agruparQuadro:(...args:Parameters<typeof quadro.agruparQuadro>)=>{counts.groups++;return quadro.agruparQuadro(...args);},opcoesVendedoresQuadro:(...args:Parameters<typeof quadro.opcoesVendedoresQuadro>)=>{counts.vendors++;return quadro.opcoesVendedoresQuadro(...args);},
    Kanban:'kanban',Cartao:'card',MarcaQuadro:'mark',Paginacao:'pagination',ProducaoEspelhoFicha:'sheet',ProducaoEspelhoIndicadores:'indicators',Metadados:'metadata',labelsIndicadores:{},
    Search:'search-icon',UserRound:'user-icon',LayoutGrid:'grid-icon',PauseCircle:'pause-icon',ArrowUpDown:'sort-icon',List:'list-icon',RefreshCw:'refresh-icon',Printer:'printer-icon',Filter:'filter-icon',
    Dialog:{Root:'dialog-root',Portal:'dialog-portal',Overlay:'dialog-overlay',Content:'dialog-content',Title:'dialog-title',Description:'dialog-description'}};
  const code=ts.transpileModule(node.getText(ast)+'\n;Catalogo',{compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
  const Catalogo=vm.runInNewContext(code,context) as (props:Record<string,unknown>)=>React.ReactElement;
  const card:consulta.CardEspelho={id:'00000000-0000-4000-8abc-000000000001',pedidoId:null,numeroOrcamento:'TEST',cliente:'Cliente sintético',vendedor:'Alvaro',etapa:'SOLDA',atualizadoEm:'2026-10-03T12:00:00Z',dadosOriginais:{created_at:'2026-10-03T12:00:00Z',excluido:false,checklist_compras:null,vinculo:'nao_verificado',historico:[],setores:[],logistica:null}};
  const props={identityKey:'synthetic',atualizar(){},fetching:false,renderFicha:()=>null,data:{consultadoEm:'2026-10-03T12:00:00Z',parcial:false,dados:{cards:[card],kpis:{},porEtapa:{},porSetor:{}},totals:{cards:1,historico:0,logistica:0,setores:0,checklists:0}}};
  return {counts,card,render(){cursor=0;return Catalogo(props);}};
}
function find(node:unknown,predicate:(element:React.ReactElement)=>boolean):React.ReactElement|undefined {
  if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return undefined;}
  if(!React.isValidElement<{children?:unknown}>(node))return undefined;if(predicate(node))return node;return find(node.props.children,predicate);
}
test('opening the actual ficha keeps board rows, date, callback and selectors stable',()=>{
  const app=mountCatalogo(),first=app.render(),board=find(first,n=>n.type==='kanban');assert.ok(board);
  board.props.onOpen(app.card,{});const second=app.render(),boardAfter=find(second,n=>n.type==='kanban');assert.ok(boardAfter);
  assert.equal(find(second,n=>n.type==='dialog-root')?.props.open,true);
  assert.equal(boardAfter.props.cards,board.props.cards);assert.equal(boardAfter.props.hoje,board.props.hoje);assert.equal(boardAfter.props.onOpen,board.props.onOpen);
  assert.deepEqual(app.counts,{filter:1,groups:1,vendors:1});
});
test('actual filtering invalidates a previous opener so an old card callback cannot reopen its ficha',()=>{
  const app=mountCatalogo(),first=app.render(),oldBoard=find(first,n=>n.type==='kanban'),search=find(first,n=>n.type==='input');assert.ok(oldBoard);assert.ok(search);
  search.props.onChange({target:{value:'Sem correspondência'}});app.render();oldBoard.props.onOpen(app.card,{});
  const final=app.render();assert.equal(find(final,n=>n.type==='dialog-root')?.props.open,false);assert.equal(find(final,n=>n.type==='kanban')?.props.cards.length,0);
});
