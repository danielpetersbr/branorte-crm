import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Line, Text, Group, Circle } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  Factory, Eraser, Download, Crosshair, MousePointer2, Minus, Square, Undo2,
} from 'lucide-react'

const PX_PER_METER = 50
const SNAP_METERS = 0.5
const MIN_SCALE = 0.2
const MAX_SCALE = 5
const ZOOM_STEP = 1.05
const HISTORY_MAX = 50
const WALL_THICKNESS_M = 0.2

type Tool = 'select' | 'wall' | 'area'
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

interface Wall {
  id: string
  pointsM: number[] // [x1,y1,x2,y2,...]
}

interface Area {
  id: string
  xM: number
  yM: number
  widthM: number
  heightM: number
}

interface Snapshot {
  shapes: PlacedShape[]
  walls: Wall[]
  areas: Area[]
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
  const [walls, setWalls] = useState<Wall[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [pendingWall, setPendingWall] = useState<number[] | null>(null) // pontos em metros
  const [pendingArea, setPendingArea] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [cursorM, setCursorM] = useState<{ x: number; y: number } | null>(null)

  const [spaceDown, setSpaceDown] = useState(false)
  const dragKindRef = useRef<EquipKind | null>(null)
  const isPanning = useRef(false)
  const panStart = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const centeredRef = useRef(false)

  // Refs pra histórico capturar state mais recente sem closure stale
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  const wallsRef = useRef(walls); wallsRef.current = walls
  const areasRef = useRef(areas); areasRef.current = areas
  const [history, setHistory] = useState<Snapshot[]>([])

  const pushHistory = () => {
    setHistory(h => [
      ...h.slice(-(HISTORY_MAX - 1)),
      { shapes: [...shapesRef.current], walls: [...wallsRef.current], areas: [...areasRef.current] },
    ])
  }
  const undo = () => {
    setHistory(h => {
      if (h.length === 0) return h
      const last = h[h.length - 1]
      setShapes(last.shapes)
      setWalls(last.walls)
      setAreas(last.areas)
      setSelectedId(null)
      setPendingWall(null)
      setPendingArea(null)
      return h.slice(0, -1)
    })
  }

  // Resize
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!centeredRef.current && size.width > 0 && size.height > 0) {
      setPos({ x: size.width / 2, y: size.height / 2 })
      centeredRef.current = true
    }
  }, [size.width, size.height])

  // Atalhos
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.code === 'Space') { setSpaceDown(true); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
      if (e.key === 'Escape') {
        setPendingWall(null); setPendingArea(null); setSelectedId(null); return
      }
      if (e.key === 'Enter' && pendingWall && pendingWall.length >= 4) {
        finalizeWall(); return
      }
      if (e.key === 'Delete' && selectedId) {
        pushHistory()
        setShapes(prev => prev.filter(s => s.id !== selectedId))
        setWalls(prev => prev.filter(w => w.id !== selectedId))
        setAreas(prev => prev.filter(a => a.id !== selectedId))
        setSelectedId(null)
        return
      }
      if (e.key === '1') setTool('select')
      if (e.key === '2') setTool('wall')
      if (e.key === '3') setTool('area')
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [selectedId, pendingWall])

  // Quando troca tool, cancela operação pendente
  useEffect(() => { setPendingWall(null); setPendingArea(null) }, [tool])

  // Zoom relativo ao cursor
  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current; if (!stage) return
    const oldScale = scale
    const pointer = stage.getPointerPosition(); if (!pointer) return
    const before = { x: (pointer.x - pos.x) / oldScale, y: (pointer.y - pos.y) / oldScale }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    let newScale = direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))
    setScale(newScale)
    setPos({ x: pointer.x - before.x * newScale, y: pointer.y - before.y * newScale })
  }

  // Helpers de coordenada
  const screenToWorldM = (sx: number, sy: number) => ({
    x: (sx - pos.x) / scale / PX_PER_METER,
    y: (sy - pos.y) / scale / PX_PER_METER,
  })

  // Mouse no Stage
  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const middle = e.evt.button === 1
    if (middle || spaceDown) {
      isPanning.current = true
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY, sx: pos.x, sy: pos.y }
      e.evt.preventDefault()
      return
    }

    const stage = stageRef.current; if (!stage) return
    const pointer = stage.getPointerPosition(); if (!pointer) return
    const w = screenToWorldM(pointer.x, pointer.y)
    const sx = snap(w.x), sy = snap(w.y)

    if (tool === 'wall') {
      // Adiciona ponto
      setPendingWall(prev => {
        if (!prev) return [sx, sy]
        return [...prev, sx, sy]
      })
      return
    }

    if (tool === 'area') {
      if (!pendingArea) {
        setPendingArea({ x0: sx, y0: sy, x1: sx, y1: sy })
      } else {
        // Finaliza
        const xM = Math.min(pendingArea.x0, sx)
        const yM = Math.min(pendingArea.y0, sy)
        const widthM = Math.abs(sx - pendingArea.x0)
        const heightM = Math.abs(sy - pendingArea.y0)
        if (widthM > 0 && heightM > 0) {
          pushHistory()
          setAreas(prev => [...prev, { id: uid(), xM, yM, widthM, heightM }])
        }
        setPendingArea(null)
      }
      return
    }

    // tool === 'select': clique vazio deseleciona
    if (e.target === e.target.getStage()) setSelectedId(null)
  }

  const handleMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    if (isPanning.current && panStart.current) {
      const dx = e.evt.clientX - panStart.current.x
      const dy = e.evt.clientY - panStart.current.y
      setPos({ x: panStart.current.sx + dx, y: panStart.current.sy + dy })
      return
    }
    const stage = stageRef.current; if (!stage) return
    const pointer = stage.getPointerPosition(); if (!pointer) return
    const w = screenToWorldM(pointer.x, pointer.y)
    const sx = snap(w.x), sy = snap(w.y)
    setCursorM({ x: sx, y: sy })
    if (tool === 'area' && pendingArea) {
      setPendingArea({ ...pendingArea, x1: sx, y1: sy })
    }
  }

  const handleMouseUp = () => {
    isPanning.current = false
    panStart.current = null
  }

  const handleStageDblClick = () => {
    if (tool === 'wall' && pendingWall && pendingWall.length >= 4) {
      finalizeWall()
    }
  }

  const finalizeWall = () => {
    if (!pendingWall || pendingWall.length < 4) { setPendingWall(null); return }
    pushHistory()
    setWalls(prev => [...prev, { id: uid(), pointsM: [...pendingWall] }])
    setPendingWall(null)
  }

  // Grid
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
        stroke: major ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.22)',
        strokeWidth: major ? 1 : 0.5,
      })
    }
    for (let my = startMy; my <= endMy; my++) {
      const y = my * PX_PER_METER
      const major = my % 5 === 0
      lines.push({
        points: [startMx * PX_PER_METER, y, endMx * PX_PER_METER, y],
        stroke: major ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.22)',
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
  const handleCanvasDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const kind = dragKindRef.current
    dragKindRef.current = null
    if (!kind) return
    const def = CATALOG.find(c => c.kind === kind); if (!def) return
    const stage = stageRef.current; if (!stage) return
    const rect = stage.container().getBoundingClientRect()
    const w = screenToWorldM(e.clientX - rect.left, e.clientY - rect.top)
    const xM = snap(w.x - def.widthM / 2)
    const yM = snap(w.y - def.heightM / 2)
    pushHistory()
    const novo: PlacedShape = {
      id: uid(), kind: def.kind, label: def.label, xM, yM,
      widthM: def.widthM, heightM: def.heightM, fill: def.fill, stroke: def.stroke,
    }
    setShapes(prev => [...prev, novo])
    setSelectedId(novo.id)
    setTool('select')
  }

  const handleShapeDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER)
    const yM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setShapes(prev => prev.map(s => (s.id === id ? { ...s, xM, yM } : s)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }

  const handleAreaDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER)
    const yM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setAreas(prev => prev.map(a => (a.id === id ? { ...a, xM, yM } : a)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }

  const limpar = () => {
    if (shapes.length === 0 && walls.length === 0 && areas.length === 0) return
    if (!confirm('Remover TUDO do canvas?')) return
    pushHistory()
    setShapes([]); setWalls([]); setAreas([])
    setSelectedId(null); setPendingWall(null); setPendingArea(null)
  }

  const exportarPNG = () => {
    const stage = stageRef.current; if (!stage) return
    const dataURL = stage.toDataURL({ pixelRatio: 2 })
    const a = document.createElement('a')
    a.href = dataURL
    a.download = `planta-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
  }

  const resetCamera = () => { setScale(1); setPos({ x: size.width / 2, y: size.height / 2 }) }

  // Cursor
  const cursor = spaceDown ? 'grab' : tool === 'wall' || tool === 'area' ? 'crosshair' : 'default'

  // Preview da parede em desenho
  const wallPreviewPx = useMemo(() => {
    if (!pendingWall || pendingWall.length === 0) return null
    const pts = [...pendingWall]
    if (cursorM) pts.push(cursorM.x, cursorM.y)
    return pts.map(v => v * PX_PER_METER)
  }, [pendingWall, cursorM])

  // Preview da área
  const areaPreview = useMemo(() => {
    if (!pendingArea) return null
    const xM = Math.min(pendingArea.x0, pendingArea.x1)
    const yM = Math.min(pendingArea.y0, pendingArea.y1)
    const widthM = Math.abs(pendingArea.x1 - pendingArea.x0)
    const heightM = Math.abs(pendingArea.y1 - pendingArea.y0)
    return { xM, yM, widthM, heightM }
  }, [pendingArea])

  const ToolBtn = ({ id, icon: Icon, label, shortcut }: { id: Tool; icon: typeof MousePointer2; label: string; shortcut: string }) => {
    const active = tool === id
    return (
      <button
        onClick={() => setTool(id)}
        title={`${label} (${shortcut})`}
        className={
          'px-2.5 py-1.5 text-[12px] rounded-md inline-flex items-center gap-1.5 transition border ' +
          (active
            ? 'bg-accent text-white border-accent'
            : 'border-border text-ink-muted hover:text-ink hover:bg-surface-2')
        }
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
        <span className="text-[10px] opacity-70">[{shortcut}]</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface flex-wrap">
        <h1 className="text-[14px] font-semibold text-ink flex items-center gap-2 mr-2">
          <Factory className="h-4 w-4 text-accent" />
          Projeto · Planta
        </h1>

        <div className="flex items-center gap-1 mr-2 pr-2 border-r border-border">
          <ToolBtn id="select" icon={MousePointer2} label="Selecionar" shortcut="1" />
          <ToolBtn id="wall" icon={Minus} label="Parede" shortcut="2" />
          <ToolBtn id="area" icon={Square} label="Área" shortcut="3" />
        </div>

        <button
          onClick={undo}
          disabled={history.length === 0}
          title="Desfazer (Ctrl+Z)"
          className="px-2.5 py-1.5 text-[12px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Desfazer
        </button>
        <button onClick={resetCamera} className="px-2.5 py-1.5 text-[12px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5" /> Centralizar
        </button>
        <button onClick={exportarPNG} className="px-2.5 py-1.5 text-[12px] rounded-md bg-accent text-white hover:opacity-90 transition inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" /> PNG
        </button>
        <button onClick={limpar} className="px-2.5 py-1.5 text-[12px] rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition inline-flex items-center gap-1.5">
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </button>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-muted">
          {cursorM && <span className="tabular-nums">x: <strong className="text-ink">{cursorM.x.toFixed(1)}m</strong> · y: <strong className="text-ink">{cursorM.y.toFixed(1)}m</strong></span>}
          <span>Eq: <strong className="text-ink">{shapes.length}</strong></span>
          <span>Pa: <strong className="text-ink">{walls.length}</strong></span>
          <span>Ár: <strong className="text-ink">{areas.length}</strong></span>
          <span>Zoom: <strong className="text-ink">{(scale * 100).toFixed(0)}%</strong></span>
        </div>
      </div>

      {/* Status bar do modo ativo */}
      <div className="px-4 py-1.5 text-[11px] text-ink-muted bg-surface-2 border-b border-border">
        {tool === 'select' && <span>Modo Selecionar — clique numa shape pra selecionar · Delete remove · arraste pra mover</span>}
        {tool === 'wall' && <span>Modo Parede — clique pra adicionar pontos · Enter ou duplo-clique finaliza · Esc cancela</span>}
        {tool === 'area' && <span>Modo Área — clique no canto inicial e depois no canto oposto · Esc cancela</span>}
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
                <div className="text-[12px] font-medium" style={{ color: def.stroke }}>{def.label}</div>
                <div className="text-[11px] text-slate-700">{def.widthM} × {def.heightM} m</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-ink-faint">Arraste um item para o canvas.</p>
        </aside>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-surface"
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
            onDblClick={handleStageDblClick}
          >
            {/* Grid */}
            <Layer listening={false}>
              {gridLines.map((l, i) => (
                <Line key={i} points={l.points} stroke={l.stroke} strokeWidth={l.strokeWidth / scale} />
              ))}
              <Line points={[-9999, 0, 9999, 0]} stroke="rgba(148,163,184,0.7)" strokeWidth={1 / scale} />
              <Line points={[0, -9999, 0, 9999]} stroke="rgba(148,163,184,0.7)" strokeWidth={1 / scale} />
            </Layer>

            {/* Áreas (renderizadas atrás das paredes e equipamentos) */}
            <Layer>
              {areas.map(a => {
                const selected = a.id === selectedId
                return (
                  <Group
                    key={a.id}
                    x={a.xM * PX_PER_METER}
                    y={a.yM * PX_PER_METER}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(a.id)}
                    onTap={() => tool === 'select' && setSelectedId(a.id)}
                    onDragEnd={(e) => handleAreaDragEnd(a.id, e)}
                  >
                    <Rect
                      width={a.widthM * PX_PER_METER}
                      height={a.heightM * PX_PER_METER}
                      fill="rgba(148,163,184,0.10)"
                      stroke={selected ? '#0ea5e9' : 'rgba(100,116,139,0.7)'}
                      strokeWidth={(selected ? 2 : 1) / scale}
                      dash={[8 / scale, 4 / scale]}
                    />
                    <Text
                      text={`${a.widthM.toFixed(1)} × ${a.heightM.toFixed(1)} m`}
                      x={6 / scale}
                      y={6 / scale}
                      fontSize={11 / scale}
                      fill="#64748b"
                    />
                  </Group>
                )
              })}

              {/* Preview da área em desenho */}
              {areaPreview && areaPreview.widthM > 0 && areaPreview.heightM > 0 && (
                <Rect
                  x={areaPreview.xM * PX_PER_METER}
                  y={areaPreview.yM * PX_PER_METER}
                  width={areaPreview.widthM * PX_PER_METER}
                  height={areaPreview.heightM * PX_PER_METER}
                  stroke="#0ea5e9"
                  strokeWidth={1.5 / scale}
                  dash={[6 / scale, 3 / scale]}
                  fill="rgba(14,165,233,0.05)"
                />
              )}
            </Layer>

            {/* Paredes */}
            <Layer>
              {walls.map(w => {
                const selected = w.id === selectedId
                return (
                  <Line
                    key={w.id}
                    points={w.pointsM.map(v => v * PX_PER_METER)}
                    stroke={selected ? '#0ea5e9' : '#1f2937'}
                    strokeWidth={(WALL_THICKNESS_M * PX_PER_METER) }
                    lineCap="round"
                    lineJoin="round"
                    onClick={() => tool === 'select' && setSelectedId(w.id)}
                    onTap={() => tool === 'select' && setSelectedId(w.id)}
                    hitStrokeWidth={Math.max(12, WALL_THICKNESS_M * PX_PER_METER + 6)}
                  />
                )
              })}

              {/* Preview da parede em desenho */}
              {wallPreviewPx && wallPreviewPx.length >= 4 && (
                <>
                  <Line
                    points={wallPreviewPx}
                    stroke="#0ea5e9"
                    strokeWidth={WALL_THICKNESS_M * PX_PER_METER}
                    opacity={0.6}
                    lineCap="round"
                    lineJoin="round"
                    dash={[8 / scale, 4 / scale]}
                  />
                  {/* Marcadores nos pontos confirmados */}
                  {pendingWall && pendingWall.length >= 2 && (() => {
                    const dots = []
                    for (let i = 0; i < pendingWall.length; i += 2) {
                      dots.push(
                        <Circle
                          key={i}
                          x={pendingWall[i] * PX_PER_METER}
                          y={pendingWall[i + 1] * PX_PER_METER}
                          radius={5 / scale}
                          fill="#0ea5e9"
                        />
                      )
                    }
                    return dots
                  })()}
                </>
              )}
            </Layer>

            {/* Equipamentos */}
            <Layer>
              {shapes.map(s => {
                const selected = s.id === selectedId
                return (
                  <Group
                    key={s.id}
                    x={s.xM * PX_PER_METER}
                    y={s.yM * PX_PER_METER}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(s.id)}
                    onTap={() => tool === 'select' && setSelectedId(s.id)}
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

          {shapes.length === 0 && walls.length === 0 && areas.length === 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-ink-muted text-[12px] bg-bg/85 px-4 py-2 rounded-md border border-border shadow-sm">
                Arraste equipamentos · use [2] Parede pra desenhar paredes · [3] Área pra zonas
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
