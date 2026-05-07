import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Factory, Eraser, Download, Crosshair } from 'lucide-react'

const PX_PER_METER = 50
const SNAP_METERS = 0.5
const MIN_SCALE = 0.2
const MAX_SCALE = 5
const ZOOM_STEP = 1.05

type EquipKind = 'silo' | 'moinho' | 'mixer' | 'peletizadora' | 'ensacadeira'

interface EquipDef {
  kind: EquipKind
  label: string
  widthM: number
  heightM: number
  fill: string
  stroke: string
}

const CATALOG: EquipDef[] = [
  { kind: 'silo',         label: 'Silo',         widthM: 2,   heightM: 2,   fill: '#dbeafe', stroke: '#1d4ed8' },
  { kind: 'moinho',       label: 'Moinho',       widthM: 2.5, heightM: 2,   fill: '#fef3c7', stroke: '#b45309' },
  { kind: 'mixer',        label: 'Mixer',        widthM: 3,   heightM: 2,   fill: '#dcfce7', stroke: '#15803d' },
  { kind: 'peletizadora', label: 'Peletizadora', widthM: 3,   heightM: 2.5, fill: '#fce7f3', stroke: '#be185d' },
  { kind: 'ensacadeira',  label: 'Ensacadeira',  widthM: 2,   heightM: 1.5, fill: '#ede9fe', stroke: '#6d28d9' },
]

interface PlacedShape {
  id: string
  kind: EquipKind
  label: string
  xM: number
  yM: number
  widthM: number
  heightM: number
  fill: string
  stroke: string
}

const snap = (v: number, step = SNAP_METERS) => Math.round(v / step) * step
const uid = () => Math.random().toString(36).slice(2, 9)

export function Projeto() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  const [size, setSize] = useState({ width: 800, height: 600 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [shapes, setShapes] = useState<PlacedShape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const dragKindRef = useRef<EquipKind | null>(null)
  const isPanning = useRef(false)
  const panStart = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const centeredRef = useRef(false)

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Centraliza no primeiro mount
  useEffect(() => {
    if (!centeredRef.current && size.width > 0 && size.height > 0) {
      setPos({ x: size.width / 2, y: size.height / 2 })
      centeredRef.current = true
    }
  }, [size.width, size.height])

  // Atalhos
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(true)
      if (e.key === 'Delete' && selectedId) {
        setShapes(prev => prev.filter(s => s.id !== selectedId))
        setSelectedId(null)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [selectedId])

  // Zoom relativo ao cursor
  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = scale
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const worldPointBefore = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    let newScale = direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))
    setScale(newScale)
    setPos({
      x: pointer.x - worldPointBefore.x * newScale,
      y: pointer.y - worldPointBefore.y * newScale,
    })
  }

  // Pan: middle-click ou Space + arrastar
  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const middle = e.evt.button === 1
    if (middle || spaceDown) {
      isPanning.current = true
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY, sx: pos.x, sy: pos.y }
      e.evt.preventDefault()
      return
    }
    if (e.target === e.target.getStage()) setSelectedId(null)
  }
  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (!isPanning.current || !panStart.current) return
    const dx = e.evt.clientX - panStart.current.x
    const dy = e.evt.clientY - panStart.current.y
    setPos({ x: panStart.current.sx + dx, y: panStart.current.sy + dy })
  }
  const handleMouseUp = () => {
    isPanning.current = false
    panStart.current = null
  }

  // Grid (linhas a cada 1m, mais escuras a cada 5m)
  const gridLines = useMemo(() => {
    const lines: { points: number[]; stroke: string; strokeWidth: number }[] = []
    if (size.width === 0 || size.height === 0) return lines
    const worldLeft = -pos.x / scale
    const worldTop = -pos.y / scale
    const worldRight = (size.width - pos.x) / scale
    const worldBottom = (size.height - pos.y) / scale
    const startMx = Math.floor(worldLeft / PX_PER_METER) - 1
    const endMx = Math.ceil(worldRight / PX_PER_METER) + 1
    const startMy = Math.floor(worldTop / PX_PER_METER) - 1
    const endMy = Math.ceil(worldBottom / PX_PER_METER) + 1
    for (let mx = startMx; mx <= endMx; mx++) {
      const x = mx * PX_PER_METER
      const major = mx % 5 === 0
      lines.push({
        points: [x, startMy * PX_PER_METER, x, endMy * PX_PER_METER],
        stroke: major ? '#cbd5e1' : '#e5e7eb',
        strokeWidth: major ? 1 : 0.5,
      })
    }
    for (let my = startMy; my <= endMy; my++) {
      const y = my * PX_PER_METER
      const major = my % 5 === 0
      lines.push({
        points: [startMx * PX_PER_METER, y, endMx * PX_PER_METER, y],
        stroke: major ? '#cbd5e1' : '#e5e7eb',
        strokeWidth: major ? 1 : 0.5,
      })
    }
    return lines
  }, [size, pos, scale])

  // Drag-from-palette
  const handlePaletteDragStart = (kind: EquipKind, e: React.DragEvent) => {
    dragKindRef.current = kind
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const kind = dragKindRef.current
    dragKindRef.current = null
    if (!kind) return
    const def = CATALOG.find(c => c.kind === kind)
    if (!def) return
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.container().getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const worldX = (screenX - pos.x) / scale
    const worldY = (screenY - pos.y) / scale
    const xM = snap(worldX / PX_PER_METER - def.widthM / 2)
    const yM = snap(worldY / PX_PER_METER - def.heightM / 2)
    const novo: PlacedShape = {
      id: uid(),
      kind: def.kind,
      label: def.label,
      xM, yM,
      widthM: def.widthM,
      heightM: def.heightM,
      fill: def.fill,
      stroke: def.stroke,
    }
    setShapes(prev => [...prev, novo])
    setSelectedId(novo.id)
  }

  const handleShapeDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER)
    const yM = snap(node.y() / PX_PER_METER)
    setShapes(prev => prev.map(s => (s.id === id ? { ...s, xM, yM } : s)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }

  const limpar = () => {
    if (shapes.length === 0) return
    if (!confirm('Remover todos os equipamentos do canvas?')) return
    setShapes([])
    setSelectedId(null)
  }

  const exportarPNG = () => {
    const stage = stageRef.current
    if (!stage) return
    const dataURL = stage.toDataURL({ pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = dataURL
    a.download = `planta-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
  }

  const resetCamera = () => {
    setScale(1)
    setPos({ x: size.width / 2, y: size.height / 2 })
  }

  const cursor = spaceDown ? 'grab' : 'default'

  return (
    <div className="flex flex-col h-screen w-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <h1 className="text-[14px] font-semibold text-ink flex items-center gap-2 mr-4">
          <Factory className="h-4 w-4 text-accent" />
          Projeto · Planta de Fábrica
        </h1>
        <button
          onClick={resetCamera}
          className="px-3 py-1.5 text-[12px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1.5"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Centralizar
        </button>
        <button
          onClick={exportarPNG}
          className="px-3 py-1.5 text-[12px] rounded-md bg-accent text-white hover:opacity-90 transition inline-flex items-center gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar PNG
        </button>
        <button
          onClick={limpar}
          className="px-3 py-1.5 text-[12px] rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition inline-flex items-center gap-1.5"
        >
          <Eraser className="h-3.5 w-3.5" />
          Limpar
        </button>
        <div className="ml-auto flex items-center gap-4 text-[11px] text-ink-muted">
          <span>Equipamentos: <strong className="text-ink">{shapes.length}</strong></span>
          <span>Zoom: <strong className="text-ink">{(scale * 100).toFixed(0)}%</strong></span>
          <span className="text-ink-faint hidden md:inline">Espaço+arrastar: pan · Scroll: zoom · Delete: remover</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Paleta */}
        <aside className="w-[200px] shrink-0 border-r border-border bg-surface p-3 overflow-y-auto">
          <h2 className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">Equipamentos</h2>
          <div className="flex flex-col gap-2">
            {CATALOG.map(def => (
              <div
                key={def.kind}
                draggable
                onDragStart={(e) => handlePaletteDragStart(def.kind, e)}
                className="cursor-grab active:cursor-grabbing rounded-md border p-2 hover:shadow-sm transition select-none"
                style={{ background: def.fill, borderColor: def.stroke }}
              >
                <div className="text-[12px] font-medium" style={{ color: def.stroke }}>
                  {def.label}
                </div>
                <div className="text-[11px] text-slate-700">
                  {def.widthM} × {def.heightM} m
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-ink-faint">
            Arraste um item para o canvas.
          </p>
        </aside>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-white"
          style={{ cursor }}
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            scaleX={scale}
            scaleY={scale}
            x={pos.x}
            y={pos.y}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <Layer listening={false}>
              {gridLines.map((l, i) => (
                <Line
                  key={i}
                  points={l.points}
                  stroke={l.stroke}
                  strokeWidth={l.strokeWidth / scale}
                />
              ))}
              <Line points={[-9999, 0, 9999, 0]} stroke="#94a3b8" strokeWidth={1 / scale} />
              <Line points={[0, -9999, 0, 9999]} stroke="#94a3b8" strokeWidth={1 / scale} />
            </Layer>

            <Layer>
              {shapes.map(s => {
                const selected = s.id === selectedId
                return (
                  <Group
                    key={s.id}
                    x={s.xM * PX_PER_METER}
                    y={s.yM * PX_PER_METER}
                    draggable
                    onClick={() => setSelectedId(s.id)}
                    onTap={() => setSelectedId(s.id)}
                    onDragEnd={(e) => handleShapeDragEnd(s.id, e)}
                  >
                    <Rect
                      width={s.widthM * PX_PER_METER}
                      height={s.heightM * PX_PER_METER}
                      fill={s.fill}
                      stroke={selected ? '#0ea5e9' : s.stroke}
                      strokeWidth={(selected ? 2.5 : 1.5) / scale}
                      cornerRadius={4 / scale}
                      shadowEnabled={selected}
                      shadowColor="#0ea5e9"
                      shadowBlur={selected ? 10 / scale : 0}
                      shadowOpacity={0.4}
                    />
                    <Text
                      text={s.label}
                      x={6 / scale}
                      y={6 / scale}
                      fontSize={12 / scale}
                      fontStyle="bold"
                      fill={s.stroke}
                    />
                    <Text
                      text={`${s.widthM.toFixed(1)} × ${s.heightM.toFixed(1)} m`}
                      x={6 / scale}
                      y={(s.heightM * PX_PER_METER) - (16 / scale)}
                      fontSize={10 / scale}
                      fill="#475569"
                    />
                  </Group>
                )
              })}
            </Layer>
          </Stage>

          {shapes.length === 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-ink-muted text-[12px] bg-white/85 px-4 py-2 rounded-md border border-border shadow-sm">
                Arraste equipamentos da paleta para começar
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
