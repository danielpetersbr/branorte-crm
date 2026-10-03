import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

function componente() {
 const file = new URL('../components/contacts/DueDiligenceButton.tsx', import.meta.url)
 const source = ts.createSourceFile(file.pathname, readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ColunaDatajud')!
 const context = { exports: {}, React,
  SubCard: ({ titulo, badge, children }: any) => React.createElement('section',{},React.createElement('h2',{},titulo),badge,children),
  AlertCircle: (props: any) => React.createElement('i',{'data-icon':'aviso',...props}),
  CheckCircle: (props: any) => React.createElement('i',{'data-icon':'confirmado',...props}),
 }
 runInNewContext(ts.transpileModule(`${fn.getText(source)}\nexport { ColunaDatajud }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,context)
 return (context.exports as any).ColunaDatajud
}
const empty = { documento:'fictício',tipoDocumento:'J',totalEncontrado:0,processos:[] }
test('falha judicial completa nunca recebe selo verde de nenhum processo',()=>{
 const html=renderToStaticMarkup(React.createElement(componente(),{datajud:{...empty,ok:false,erros:['indisponível'],resumoTribunais:[{tribunal:'QA',total:0,retornados:0,erro:'503'}]}}))
 assert.match(html,/Consulta judicial indisponível/)
 assert.doesNotMatch(html,/Nenhum processo encontrado|data-icon="confirmado"/)
})
test('consulta judicial parcial sem processos informa limite de cobertura',()=>{
 const html=renderToStaticMarkup(React.createElement(componente(),{datajud:{...empty,ok:true,erros:['indisponível'],resumoTribunais:[{tribunal:'QA',total:0,retornados:0},{tribunal:'QA2',total:0,retornados:0,erro:'503'}]}}))
 assert.match(html,/Consulta parcial/)
 assert.doesNotMatch(html,/data-icon="confirmado"/)
})
test('consulta judicial integral sem processos mantém resultado vazio confirmado',()=>{
 const html=renderToStaticMarkup(React.createElement(componente(),{datajud:{...empty,ok:true,erros:[],resumoTribunais:[{tribunal:'QA',total:0,retornados:0}]}}))
 assert.match(html,/Nenhum processo encontrado/)
 assert.match(html,/data-icon="confirmado"/)
})
