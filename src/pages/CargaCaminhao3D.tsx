// Visualizador 3D da carga dentro do caminhão. Mostra o baú do caminhão sugerido,
// empacota os itens (greedy shelf packing), exibe espaço ocupado x sobrando e deixa
// arrastar cada volume pelo piso (clamp dentro do baú). Lazy-loaded (carrega Three.js
// só quando o vendedor abre o painel).
import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'

export type Caminhao3D = { nome: string; comp: number; larg: number; alt: number; peso_max_kg?: number | null }
export type ItemCarga3D = { uid: string; nome: string; comprimento_m: number; largura_m: number; altura_m: number; qtd: number }

const CORES = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308']

type Caixa = { id: string; nome: string; cor: string; size: [number, number, number]; pos: [number, number, number] }

// Empacota cada unidade no baú (x=comprimento, z=largura, y=altura). Avança em x,
// quebra linha em z, sobe camada em y. O que não couber vira "sobra".
function empacotar(truck: Caminhao3D, itens: ItemCarga3D[]): { caixas: Caixa[]; foraN: number } {
  const L = truck.comp, W = truck.larg, H = truck.alt
  const caixas: Caixa[] = []
  let cx = 0, cz = 0, cy = 0, rowDepth = 0, layerH = 0, fora = 0
  const unidades: { it: ItemCarga3D; cor: string; i: number }[] = []
  itens.forEach((it, idx) => {
    const n = Math.max(1, Math.round(it.qtd || 1))
    for (let k = 0; k < n; k++) unidades.push({ it, cor: CORES[idx % CORES.length], i: idx })
  })
  for (const u of unidades) {
    const l = Math.max(0.1, u.it.comprimento_m || 0.1)
    const w = Math.max(0.1, u.it.largura_m || 0.1)
    const h = Math.max(0.1, u.it.altura_m || 0.1)
    if (l > L || w > W || h > H) { fora++; continue }
    if (cx + l > L + 1e-6) { cx = 0; cz += rowDepth; rowDepth = 0 }
    if (cz + w > W + 1e-6) { cz = 0; cy += layerH; layerH = 0 }
    if (cy + h > H + 1e-6) { fora++; continue }
    caixas.push({
      id: `${u.it.uid}-${caixas.length}`,
      nome: u.it.nome,
      cor: u.cor,
      size: [l, w, h],
      // centro do box no espaço do baú centrado na origem (piso em y=0)
      pos: [-L / 2 + cx + l / 2, cy + h / 2, -W / 2 + cz + w / 2],
    })
    cx += l
    rowDepth = Math.max(rowDepth, w)
    layerH = Math.max(layerH, h)
  }
  return { caixas, foraN: fora }
}

function BauCaminhao({ L, W, H }: { L: number; W: number; H: number }) {
  return (
    <group>
      {/* piso */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[L, W]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      {/* contorno do baú (wireframe) */}
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[L, H, W]} />
        <meshBasicMaterial transparent opacity={0.04} color="#3b82f6" />
        <Edges color="#64748b" />
      </mesh>
    </group>
  )
}

function CaixaCarga({ caixa, controls, dragId, setDragId, onMove, L, W }: {
  caixa: Caixa
  controls: React.MutableRefObject<any>
  dragId: string | null
  setDragId: (id: string | null) => void
  onMove: (id: string, x: number, z: number) => void
  L: number; W: number
}) {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useRef(new THREE.Vector3())
  const ativo = dragId === caixa.id
  const [l, , w] = [caixa.size[0], caixa.size[1], caixa.size[2]]
  return (
    <mesh
      position={caixa.pos}
      castShadow
      onPointerDown={(e) => {
        e.stopPropagation()
        ;(e.target as any).setPointerCapture?.(e.pointerId)
        setDragId(caixa.id)
        if (controls.current) controls.current.enabled = false
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        setDragId(null)
        if (controls.current) controls.current.enabled = true
      }}
      onPointerMove={(e) => {
        if (!ativo) return
        e.stopPropagation()
        if (e.ray.intersectPlane(plane, hit.current)) {
          const x = THREE.MathUtils.clamp(hit.current.x, -L / 2 + l / 2, L / 2 - l / 2)
          const z = THREE.MathUtils.clamp(hit.current.z, -W / 2 + w / 2, W / 2 - w / 2)
          onMove(caixa.id, x, z)
        }
      }}
    >
      <boxGeometry args={caixa.size} />
      <meshStandardMaterial color={caixa.cor} transparent opacity={ativo ? 0.95 : 0.82} emissive={ativo ? caixa.cor : '#000000'} emissiveIntensity={ativo ? 0.25 : 0} />
      <Edges color="#0f172a" />
    </mesh>
  )
}

export default function CargaCaminhao3D({ truck, itens }: { truck: Caminhao3D; itens: ItemCarga3D[] }) {
  const controls = useRef<any>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const L = Math.max(0.5, truck.comp), W = Math.max(0.5, truck.larg), H = Math.max(0.5, truck.alt)

  const base = useMemo(() => empacotar(truck, itens), [truck, itens])
  // posições editáveis (override do packing ao arrastar)
  const [overrides, setOverrides] = useState<Record<string, [number, number]>>({})
  const caixas = useMemo(
    () => base.caixas.map(c => overrides[c.id] ? { ...c, pos: [overrides[c.id][0], c.pos[1], overrides[c.id][1]] as [number, number, number] } : c),
    [base.caixas, overrides],
  )

  const volTruck = L * W * H
  const volCarga = caixas.reduce((s, c) => s + c.size[0] * c.size[1] * c.size[2], 0)
  const ocup = volTruck > 0 ? Math.min(100, (volCarga / volTruck) * 100) : 0
  const dist = Math.max(L, W, H) * 1.7

  return (
    <div className="relative w-full h-[440px] rounded-xl overflow-hidden border border-border bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
      <Canvas shadows camera={{ position: [dist, dist * 0.8, dist], fov: 42 }} dpr={[1, 2]}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[L, H * 3, W]} intensity={1.1} castShadow />
        <directionalLight position={[-L, H * 2, -W]} intensity={0.4} />
        <BauCaminhao L={L} W={W} H={H} />
        {caixas.map(c => (
          <CaixaCarga key={c.id} caixa={c} controls={controls} dragId={dragId} setDragId={setDragId}
            onMove={(id, x, z) => setOverrides(o => ({ ...o, [id]: [x, z] }))} L={L} W={W} />
        ))}
        <OrbitControls ref={controls} enablePan makeDefault minDistance={dist * 0.4} maxDistance={dist * 3} />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#fff" />
        </GizmoHelper>
      </Canvas>

      {/* Overlay de métricas */}
      <div className="absolute top-3 left-3 rounded-lg bg-black/55 text-white px-3 py-2 text-xs space-y-0.5 pointer-events-none backdrop-blur-sm">
        <div className="font-semibold">{truck.nome}</div>
        <div className="opacity-80">{L.toFixed(1)} × {W.toFixed(1)} × {H.toFixed(1)} m · {volTruck.toFixed(1)} m³</div>
        <div>Ocupado: <b>{ocup.toFixed(0)}%</b> · {volCarga.toFixed(1)} m³</div>
        <div className="opacity-80">Sobra: {(volTruck - volCarga).toFixed(1)} m³</div>
        {base.foraN > 0 && <div className="text-amber-300">⚠ {base.foraN} volume(s) não couberam</div>}
      </div>

      {/* barra de ocupação */}
      <div className="absolute bottom-3 left-3 right-3">
        <div className="h-2 rounded-full bg-black/30 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${ocup}%`, background: ocup > 95 ? '#ef4444' : ocup > 80 ? '#f59e0b' : '#22c55e' }} />
        </div>
        <div className="text-[10px] text-center mt-1 text-ink-muted">Arraste os volumes pra reposicionar · gire/zoom com o mouse</div>
      </div>
    </div>
  )
}
