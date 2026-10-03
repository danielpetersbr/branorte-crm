import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

function render(page: string, name: string, pendingIndex: number) {
 const file=new URL(`../pages/${page}.tsx`,import.meta.url)
 const source=ts.createSourceFile(file.pathname,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!
 let index=0
 const context={exports:{},React,
  useState:(initial:unknown)=>[index++===pendingIndex?true:initial,()=>{}],useRef:(initial:unknown)=>({current:initial}),useEffect:()=>{},
  useSearchParams:()=>[new URLSearchParams('vendedor=QA')],tituloNome:(s:string)=>s,
  useQuery:()=>({data:{titulo:'Reunião fictícia',data_reuniao:'2026-10-02',pauta:[],resumo:''},isLoading:false,error:null}),fmtData:()=>'Data fictícia',
  MOTIVOS:['Demora'],TIPOS:['Sugestão'],LS_NOME:'fixture',readBrowserPreference:()=>'',
 }
 runInNewContext(ts.transpileModule(`${fn.getText(source)}\nexport { ${name} }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,context)
 return renderToStaticMarkup(React.createElement((context.exports as any)[name],{token:'fixture',nomeUrl:''}))
}
for(const [page,fn,index] of [['Avaliacao','Avaliacao',5],['ReuniaoFeedback','FormularioFeedback',3]] as const) {
 test(`${page}: campos e escolhas ficam protegidos enquanto o envio confirma o snapshot`,()=>{
  const html=render(page,fn,index)
  const fieldset=html.match(/<fieldset[^>]*disabled=""[^>]*>([\s\S]*?)<\/fieldset>/)?.[1]
  assert.ok(fieldset,'fieldset desabilitado protege o formulário inteiro durante envio')
  assert.match(fieldset,/<input/)
  assert.match(fieldset,/<textarea/)
  assert.match(fieldset,/<button/)
 })
}
