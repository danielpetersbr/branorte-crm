import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Line, Text as KText, Group, Circle as KCircle } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  Factory, Eraser, Download, Crosshair, MousePointer2, Minus, Square, Undo2, Redo2,
  Pencil, Circle as CircleIcon, Type, Ruler, Trash2, Lock,
} from 'lucide-react'

const PX_PER_METER = 50
const SNAP_METERS = 0.5
const MIN_SCALE = 0.2
const MAX_SCALE = 5
const ZOOM_STEP = 1.05
const HISTORY_MAX = 50
const WALL_THICKNESS_M = 0.2

type Tool = 'select' | 'wall' | 'area' | 'circle' | 'text' | 'pencil' | 'distance' | 'erase'
type EquipKind = 'silo' | 'moinho' | 'mixer' | 'peletizadora' | 'ensacadeira'

interface EquipDef { kind: EquipKind; label: string; widthM: number; heightM: number; fill: string; stroke: string }
const CATALOG: EquipDef[] = [
  { kind: 'silo',         label: 'Silo',         widthM: 2,   heightM: 2,   fill: '#dbeafe', stroke: '#1d4ed8' },
  { kind: 'moinho',       label: 'Moinho',       widthM: 2.5, heightM: 2,   fill: '#fef3c7', stroke: '#b45309' },
  { kind: 'mixer',        label: 'Mixer',        widthM: 3,   heightM: 2,   fill: '#dcfce7', stroke: '#15803d' },
  { kind: 'peletizadora', label: 'Peletizadora', widthM: 3,   heightM: 2.5, fill: '#fce7f3', stroke: '#be185d' },
  { kind: 'ensacadeira',  label: 'Ensacadeira',  widthM: 2,   heightM: 1.5, fill: '#ede9fe', stroke: '#6d28d9' },
]

interface PlacedShape { id: string; kind: EquipKind; label: string; xM: number; yM: number; widthM: number; heightM: number; fill: string; stroke: string }
interface Wall { id: string; pointsM: number[] }
interface Area { id: string; xM: number; yM: number; widthM: number; heightM: number }
interface Sketch { id: string; pointsM: number[]; color: string; thickness: number }
interface CircleShape { id: string; cxM: number; cyM: number; rM: number; stroke: string }
interface TextItem { id: string; xM: number; yM: number; text: string; color: string }
interface Snapshot { shapes: PlacedShape[]; walls: Wall[]; areas: Area[]; sketches: Sketch[]; circles: CircleShape[]; texts: TextItem[] }

const snap = (v: number, step = SNAP_METERS) => Math.round(v / step) * step
const uid = () => Math.random().toString(36).slice(2, 9)

// Ortho: restringe (x1,y1) a horizontal ou vertical relativo a (x0,y0)
const applyOrtho = (x0: number, y0: number, x1: number, y1: number, on: boolean) => {
  if (!on) return [x1, y1] as const
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  return dx > dy ? ([x1, y0] as const) : ([x0, y1] as const)
}

export function Projeto() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  const [size, setSize] = useState({ width: 800, height: 600 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const [shapes, setShapes] = useState<PlacedShape[]>([])
  const [walls, setWalls] = useState<Wall[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [sketches, setSketches] = useState<Sketch[]>([])
  const [circles, setCircles] = useState<CircleShape[]>([])
  const [texts, setTexts] = useState<TextItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [pencilColor, setPencilColor] = useState<string>('#1f2937')
  const [ortho, setOrtho] = useState(false)

  const [pendingWall, setPendingWall] = useState<number[] | null>(null)
  const [pendingArea, setPendingArea] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [pendingSketch, setPendingSketch] = useState<number[] | null>(null)
  const [pendingCircle, setPendingCircle] = useState<{ cxM: number; cyM: number } | null>(null)
  const [pendingDistance, setPendingDistance] = useState<{ xM: number; yM: number } | null>(null)
  const [distanceResult, setDistanceResult] = useState<{ x0: number; y0: number; x1: number; y1: number; dM: number } | null>(null)
  const isPenciling = useRef(false)

  const [cursorM, setCursorM] = useState<{ x: number; y: number } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const dragKindRef = useRef<EquipKind | null>(null)
  const isPanning = useRef(false)
  const panStart = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const centeredRef = useRef(false)

  // Refs pra pegar state mais recente em handlers async
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  const wallsRef = useRef(walls); wallsRef.current = walls
  const areasRef = useRef(areas); areasRef.current = areas
  const sketchesRef = useRef(sketches); sketchesRef.current = sketches
  const circlesRef = useRef(circles); circlesRef.current = circles
  const textsRef = useRef(texts); textsRef.current = texts

  const [history, setHistory] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])

  const snapshotNow = (): Snapshot => ({
    shapes: [...shapesRef.current], walls: [...wallsRef.current], areas: [...areasRef.current],
    sketches: [...sketchesRef.current], circles: [...circlesRef.current], texts: [...textsRef.current],
  })

  const pushHistory = () => {
    setHistory(h => [...h.slice(-(HISTORY_MAX - 1)), snapshotNow()])
    setRedoStack([]) // qualquer ação nova invalida o redo
  }

  const applySnapshot = (s: Snapshot) => {
    setShapes(s.shapes); setWalls(s.walls); setAreas(s.areas)
    setSketches(s.sketches); setCircles(s.circles); setTexts(s.texts)
    setSelectedId(null); setPendingWall(null); setPendingArea(null)
    setPendingSketch(null); setPendingCircle(null); setPendingDistance(null); setDistanceResult(null)
  }

  const undo = () => {
    if (history.length === 0) return
    const last = history[history.length - 1]
    setRedoStack(r => [...r, snapshotNow()])
    applySnapshot(last)
    setHistory(h => h.slice(0, -1))
  }
  const redo = () => {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setHistory(h => [...h, snapshotNow()])
    applySnapshot(next)
    setRedoStack(r => r.slice(0, -1))
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

  // Quando troca tool, cancela operações pendentes
  useEffect(() => {
    setPendingWall(null); setPendingArea(null); setPendingSketch(null)
    setPendingCircle(null); setPendingDistance(null); setDistanceResult(null)
    isPenciling.current = false
  }, [tool])

  // Atalhos
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') { setSpaceDown(true); e.preventDefault(); return }

      // Ctrl/Cmd combos
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if ((k === 'y') || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
        return
      }

      if (e.key === 'F8') { e.preventDefault(); setOrtho(o => !o); return }
      if (e.key === 'Escape') {
        setPendingWall(null); setPendingArea(null); setPendingCircle(null)
        setPendingDistance(null); setDistanceResult(null); setSelectedId(null); return
      }
      if (e.key === 'Enter' && pendingWall && pendingWall.length >= 4) { finalizeWall(); return }
      if (e.key === 'Delete' && selectedId) {
        pushHistory()
        setShapes(p => p.filter(s => s.id !== selectedId))
        setWalls(p => p.filter(w => w.id !== selectedId))
        setAreas(p => p.filter(a => a.id !== selectedId))
        setSketches(p => p.filter(s => s.id !== selectedId))
        setCircles(p => p.filter(c => c.id !== selectedId))
        setTexts(p => p.filter(t => t.id !== selectedId))
        setSelectedId(null)
        return
      }

      const k = e.key.toLowerCase()
      if (k === 's') setTool('select')
      else if (k === 'l') setTool('wall')
      else if (k === 'r') setTool('area')
      else if (k === 'c') setTool('circle')
      else if (k === 't') setTool('text')
      else if (k === 'p') setTool('pencil')
      else if (k === 'd') setTool('distance')
      else if (k === 'e') setTool('erase')
      else if (k === 'z') resetCamera()
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [selectedId, pendingWall, history.length, redoStack.length])

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

  const screenToWorldM = (sx: number, sy: number) => ({
    x: (sx - pos.x) / scale / PX_PER_METER,
    y: (sy - pos.y) / scale / PX_PER_METER,
  })

  // Mouse Down
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
      setPendingWall(prev => {
        if (!prev) return [sx, sy]
        // Aplica ortho relativo ao ponto anterior
        const lastX = prev[prev.length - 2], lastY = prev[prev.length - 1]
        const [ox, oy] = applyOrtho(lastX, lastY, sx, sy, ortho)
        return [...prev, ox, oy]
      })
      return
    }
    if (tool === 'area') {
      if (!pendingArea) setPendingArea({ x0: sx, y0: sy, x1: sx, y1: sy })
      else {
        const xM = Math.min(pendingArea.x0, sx), yM = Math.min(pendingArea.y0, sy)
        const widthM = Math.abs(sx - pendingArea.x0), heightM = Math.abs(sy - pendingArea.y0)
        if (widthM > 0 && heightM > 0) {
          pushHistory()
          setAreas(prev => [...prev, { id: uid(), xM, yM, widthM, heightM }])
        }
        setPendingArea(null)
      }
      return
    }
    if (tool === 'circle') {
      if (!pendingCircle) setPendingCircle({ cxM: sx, cyM: sy })
      else {
        const dx = sx - pendingCircle.cxM, dy = sy - pendingCircle.cyM
        const rM = Math.sqrt(dx * dx + dy * dy)
        if (rM > 0.1) {
          pushHistory()
          setCircles(prev => [...prev, { id: uid(), cxM: pendingCircle.cxM, cyM: pendingCircle.cyM, rM, stroke: '#1f2937' }])
        }
        setPendingCircle(null)
      }
      return
    }
    if (tool === 'text') {
      const txt = window.prompt('Texto:')
      if (txt && txt.trim()) {
        pushHistory()
        setTexts(prev => [...prev, { id: uid(), xM: sx, yM: sy, text: txt.trim(), color: '#1f2937' }])
      }
      return
    }
    if (tool === 'pencil') {
      isPenciling.current = true
      setPendingSketch([w.x, w.y])
      return
    }
    if (tool === 'distance') {
      if (!pendingDistance) {
        setPendingDistance({ xM: sx, yM: sy })
        setDistanceResult(null)
      } else {
        const [ex, ey] = applyOrtho(pendingDistance.xM, pendingDistance.yM, sx, sy, ortho)
        const dM = Math.sqrt((ex - pendingDistance.xM) ** 2 + (ey - pendingDistance.yM) ** 2)
        setDistanceResult({ x0: pendingDistance.xM, y0: pendingDistance.yM, x1: ex, y1: ey, dM })
        setPendingDistance(null)
      }
      return
    }
    if (tool === 'erase') {
      // Apaga o que clicou (se tiver clicado em algo). Stage = nada.
      const target = e.target
      if (target === target.getStage()) return
      const id = (target.id() || target.findAncestor('Group')?.id?.()) as string | undefined
      if (!id) return
      pushHistory()
      setShapes(p => p.filter(s => s.id !== id))
      setWalls(p => p.filter(w => w.id !== id))
      setAreas(p => p.filter(a => a.id !== id))
      setSketches(p => p.filter(s => s.id !== id))
      setCircles(p => p.filter(c => c.id !== id))
      setTexts(p => p.filter(t => t.id !== id))
      return
    }

    // select: clique vazio deseleciona
    if (e.target === e.target.getStage()) setSelectedId(null)
  }

  // Mouse Move
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

    if (tool === 'area' && pendingArea) setPendingArea({ ...pendingArea, x1: sx, y1: sy })
    if (tool === 'pencil' && isPenciling.current) {
      setPendingSketch(prev => prev ? [...prev, w.x, w.y] : [w.x, w.y])
    }
  }

  const handleMouseUp = () => {
    isPanning.current = false
    panStart.current = null
    if (tool === 'pencil' && isPenciling.current) {
      isPenciling.current = false
      const pts = pendingSketch
      setPendingSketch(null)
      if (pts && pts.length >= 4) {
        pushHistory()
        setSketches(prev => [...prev, { id: uid(), pointsM: [...pts], color: pencilColor, thickness: 3 }])
      }
    }
  }

  const handleStageDblClick = () => {
    if (tool === 'wall' && pendingWall && pendingWall.length >= 4) finalizeWall()
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
    const wL = -pos.x / scale, wT = -pos.y / scale
    const wR = (size.width - pos.x) / scale, wB = (size.height - pos.y) / scale
    const sX = Math.floor(wL / PX_PER_METER) - 1, eX = Math.ceil(wR / PX_PER_METER) + 1
    const sY = Math.floor(wT / PX_PER_METER) - 1, eY = Math.ceil(wB / PX_PER_METER) + 1
    for (let mx = sX; mx <= eX; mx++) {
      const x = mx * PX_PER_METER, major = mx % 5 === 0
      lines.push({ points: [x, sY * PX_PER_METER, x, eY * PX_PER_METER],
        stroke: major ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.22)', strokeWidth: major ? 1 : 0.5 })
    }
    for (let my = sY; my <= eY; my++) {
      const y = my * PX_PER_METER, major = my % 5 === 0
      lines.push({ points: [sX * PX_PER_METER, y, eX * PX_PER_METER, y],
        stroke: major ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.22)', strokeWidth: major ? 1 : 0.5 })
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
    const kind = dragKindRef.current; dragKindRef.current = null
    if (!kind) return
    const def = CATALOG.find(c => c.kind === kind); if (!def) return
    const stage = stageRef.current; if (!stage) return
    const rect = stage.container().getBoundingClientRect()
    const w = screenToWorldM(e.clientX - rect.left, e.clientY - rect.top)
    const xM = snap(w.x - def.widthM / 2), yM = snap(w.y - def.heightM / 2)
    pushHistory()
    const novo: PlacedShape = { id: uid(), kind: def.kind, label: def.label, xM, yM, widthM: def.widthM, heightM: def.heightM, fill: def.fill, stroke: def.stroke }
    setShapes(prev => [...prev, novo])
    setSelectedId(novo.id)
    setTool('select')
  }

  const handleShapeDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER), yM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setShapes(prev => prev.map(s => (s.id === id ? { ...s, xM, yM } : s)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }
  const handleAreaDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER), yM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setAreas(prev => prev.map(a => (a.id === id ? { ...a, xM, yM } : a)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }
  const handleCircleDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const cxM = snap(node.x() / PX_PER_METER), cyM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setCircles(prev => prev.map(c => (c.id === id ? { ...c, cxM, cyM } : c)))
    node.position({ x: cxM * PX_PER_METER, y: cyM * PX_PER_METER })
  }
  const handleTextDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const xM = snap(node.x() / PX_PER_METER), yM = snap(node.y() / PX_PER_METER)
    pushHistory()
    setTexts(prev => prev.map(t => (t.id === id ? { ...t, xM, yM } : t)))
    node.position({ x: xM * PX_PER_METER, y: yM * PX_PER_METER })
  }

  const limpar = () => {
    if (!shapes.length && !walls.length && !areas.length && !sketches.length && !circles.length && !texts.length) return
    if (!confirm('Remover TUDO do canvas?')) return
    pushHistory()
    setShapes([]); setWalls([]); setAreas([]); setSketches([]); setCircles([]); setTexts([])
    setSelectedId(null)
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
  const cursor = spaceDown
    ? 'grab'
    : (tool === 'wall' || tool === 'area' || tool === 'circle' || tool === 'text' || tool === 'pencil' || tool === 'distance')
      ? 'crosshair'
      : tool === 'erase' ? 'not-allowed' : 'default'

  // Preview da parede (com ortho aplicado ao último segmento)
  const wallPreviewPx = useMemo(() => {
    if (!pendingWall || pendingWall.length === 0) return null
    const pts = [...pendingWall]
    if (cursorM) {
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1]
      const [ox, oy] = applyOrtho(lx, ly, cursorM.x, cursorM.y, ortho)
      pts.push(ox, oy)
    }
    return pts.map(v => v * PX_PER_METER)
  }, [pendingWall, cursorM, ortho])

  // Preview da área
  const areaPreview = useMemo(() => {
    if (!pendingArea) return null
    const xM = Math.min(pendingArea.x0, pendingArea.x1), yM = Math.min(pendingArea.y0, pendingArea.y1)
    const widthM = Math.abs(pendingArea.x1 - pendingArea.x0), heightM = Math.abs(pendingArea.y1 - pendingArea.y0)
    return { xM, yM, widthM, heightM }
  }, [pendingArea])

  // Preview do círculo
  const circlePreview = useMemo(() => {
    if (!pendingCircle || !cursorM) return null
    const dx = cursorM.x - pendingCircle.cxM, dy = cursorM.y - pendingCircle.cyM
    return { cxM: pendingCircle.cxM, cyM: pendingCircle.cyM, rM: Math.sqrt(dx * dx + dy * dy) }
  }, [pendingCircle, cursorM])

  // Preview da medida (durante medição)
  const distancePreview = useMemo(() => {
    if (!pendingDistance || !cursorM) return null
    const [ex, ey] = applyOrtho(pendingDistance.xM, pendingDistance.yM, cursorM.x, cursorM.y, ortho)
    const dM = Math.sqrt((ex - pendingDistance.xM) ** 2 + (ey - pendingDistance.yM) ** 2)
    return { x0: pendingDistance.xM, y0: pendingDistance.yM, x1: ex, y1: ey, dM }
  }, [pendingDistance, cursorM, ortho])

  const ToolBtn = ({ id, icon: Icon, label, shortcut }: { id: Tool; icon: typeof MousePointer2; label: string; shortcut: string }) => {
    const active = tool === id
    return (
      <button
        onClick={() => setTool(id)}
        title={`${label} (${shortcut})`}
        className={
          'h-8 px-2 text-[11px] rounded-md inline-flex items-center gap-1 transition border ' +
          (active ? 'bg-accent text-white border-accent' : 'border-border text-ink-muted hover:text-ink hover:bg-surface-2')
        }
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{label}</span>
        <span className="text-[10px] opacity-70">[{shortcut}]</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-surface flex-wrap">
        <h1 className="text-[13px] font-semibold text-ink flex items-center gap-1.5 mr-2">
          <Factory className="h-4 w-4 text-accent" />
          Projeto
        </h1>

        <div className="flex items-center gap-0.5 mr-1 pr-1 border-r border-border">
          <ToolBtn id="select" icon={MousePointer2} label="Selecionar" shortcut="S" />
          <ToolBtn id="wall" icon={Minus} label="Linha" shortcut="L" />
          <ToolBtn id="area" icon={Square} label="Retângulo" shortcut="R" />
          <ToolBtn id="circle" icon={CircleIcon} label="Círculo" shortcut="C" />
          <ToolBtn id="text" icon={Type} label="Texto" shortcut="T" />
          <ToolBtn id="pencil" icon={Pencil} label="Lápis" shortcut="P" />
          <ToolBtn id="distance" icon={Ruler} label="Medir" shortcut="D" />
          <ToolBtn id="erase" icon={Trash2} label="Apagar" shortcut="E" />
        </div>

        {tool === 'pencil' && (
          <div className="flex items-center gap-1 mr-1 pr-1 border-r border-border">
            {['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'].map(c => (
              <button
                key={c}
                onClick={() => setPencilColor(c)}
                title={`Cor ${c}`}
                className={'h-5 w-5 rounded-full border-2 transition ' + (pencilColor === c ? 'border-ink scale-110' : 'border-border hover:border-ink-muted')}
                style={{ background: c }}
              />
            ))}
          </div>
        )}

        <button
          onClick={() => setOrtho(o => !o)}
          title="Ortho — limita movimento a 0/90° (F8)"
          className={
            'h-8 px-2 text-[11px] rounded-md inline-flex items-center gap-1 border transition ' +
            (ortho ? 'bg-accent text-white border-accent' : 'border-border text-ink-muted hover:text-ink hover:bg-surface-2')
          }
        >
          <Lock className="h-3.5 w-3.5" />
          Ortho <span className="text-[10px] opacity-70">[F8]</span>
        </button>

        <button onClick={undo} disabled={history.length === 0} title="Desfazer (Ctrl+Z)"
          className="h-8 px-2 text-[11px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1 disabled:opacity-40">
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={redo} disabled={redoStack.length === 0} title="Refazer (Ctrl+Y)"
          className="h-8 px-2 text-[11px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1 disabled:opacity-40">
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={resetCamera} title="Centralizar (Z)"
          className="h-8 px-2 text-[11px] rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition inline-flex items-center gap-1">
          <Crosshair className="h-3.5 w-3.5" />
        </button>
        <button onClick={exportarPNG} title="Exportar PNG"
          className="h-8 px-2 text-[11px] rounded-md bg-accent text-white hover:opacity-90 transition inline-flex items-center gap-1">
          <Download className="h-3.5 w-3.5" /> PNG
        </button>
        <button onClick={limpar} title="Limpar tudo"
          className="h-8 px-2 text-[11px] rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition inline-flex items-center gap-1">
          <Eraser className="h-3.5 w-3.5" />
        </button>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-muted">
          {cursorM && <span className="tabular-nums">x: <strong className="text-ink">{cursorM.x.toFixed(1)}m</strong> y: <strong className="text-ink">{cursorM.y.toFixed(1)}m</strong></span>}
          <span>Zoom: <strong className="text-ink">{(scale * 100).toFixed(0)}%</strong></span>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 text-[11px] text-ink-muted bg-surface-2 border-b border-border flex items-center justify-between gap-2">
        <span>
          {tool === 'select' && 'Selecionar — clique numa shape · Delete remove · arraste pra mover'}
          {tool === 'wall' && 'Linha — clique pontos · Enter/duplo-clique finaliza · Esc cancela'}
          {tool === 'area' && 'Retângulo — clique 2 cantos opostos'}
          {tool === 'circle' && 'Círculo — clique no centro, depois clique pra definir o raio'}
          {tool === 'text' && 'Texto — clique no canvas, abre prompt pra digitar'}
          {tool === 'pencil' && 'Lápis — pressiona e arrasta pra desenhar à mão livre'}
          {tool === 'distance' && 'Medir — clique 2 pontos, distância em metros aparece'}
          {tool === 'erase' && 'Apagar — clique numa shape pra remover imediatamente'}
        </span>
        <span className="flex items-center gap-3">
          {distanceResult && (
            <span className="text-accent font-semibold tabular-nums">Distância: {distanceResult.dM.toFixed(2)} m</span>
          )}
          <span className={ortho ? 'text-accent font-semibold' : ''}>Ortho: {ortho ? 'ON' : 'OFF'}</span>
          <span>Itens: {shapes.length + walls.length + areas.length + sketches.length + circles.length + texts.length}</span>
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Paleta */}
        <aside className="w-[180px] shrink-0 border-r border-border bg-surface p-3 overflow-y-auto">
          <h2 className="text-[10px] uppercase tracking-widest text-ink-faint mb-2">Equipamentos</h2>
          <div className="flex flex-col gap-2">
            {CATALOG.map(def => (
              <div key={def.kind} draggable onDragStart={(e) => handlePaletteDragStart(def.kind, e)}
                className="cursor-grab active:cursor-grabbing rounded-md border p-2 hover:shadow-sm transition select-none"
                style={{ background: def.fill, borderColor: def.stroke }}>
                <div className="text-[12px] font-medium" style={{ color: def.stroke }}>{def.label}</div>
                <div className="text-[11px] text-slate-700">{def.widthM} × {def.heightM} m</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-ink-faint">Arraste um item para o canvas.</p>
        </aside>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-surface" style={{ cursor }}
          onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
          <Stage
            ref={stageRef}
            width={size.width} height={size.height}
            scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDblClick={handleStageDblClick}
          >
            {/* Grid */}
            <Layer listening={false}>
              {gridLines.map((l, i) => <Line key={i} points={l.points} stroke={l.stroke} strokeWidth={l.strokeWidth / scale} />)}
              <Line points={[-9999, 0, 9999, 0]} stroke="rgba(148,163,184,0.7)" strokeWidth={1 / scale} />
              <Line points={[0, -9999, 0, 9999]} stroke="rgba(148,163,184,0.7)" strokeWidth={1 / scale} />
            </Layer>

            {/* Áreas */}
            <Layer>
              {areas.map(a => {
                const selected = a.id === selectedId
                return (
                  <Group key={a.id} id={a.id} x={a.xM * PX_PER_METER} y={a.yM * PX_PER_METER}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(a.id)}
                    onTap={() => tool === 'select' && setSelectedId(a.id)}
                    onDragEnd={(e) => handleAreaDragEnd(a.id, e)}>
                    <Rect id={a.id} width={a.widthM * PX_PER_METER} height={a.heightM * PX_PER_METER}
                      fill="rgba(148,163,184,0.10)"
                      stroke={selected ? '#0ea5e9' : 'rgba(100,116,139,0.7)'}
                      strokeWidth={(selected ? 2 : 1) / scale}
                      dash={[8 / scale, 4 / scale]} />
                    <KText text={`${a.widthM.toFixed(1)} × ${a.heightM.toFixed(1)} m`}
                      x={6 / scale} y={6 / scale} fontSize={11 / scale} fill="#64748b" />
                  </Group>
                )
              })}
              {areaPreview && areaPreview.widthM > 0 && areaPreview.heightM > 0 && (
                <Rect x={areaPreview.xM * PX_PER_METER} y={areaPreview.yM * PX_PER_METER}
                  width={areaPreview.widthM * PX_PER_METER} height={areaPreview.heightM * PX_PER_METER}
                  stroke="#0ea5e9" strokeWidth={1.5 / scale} dash={[6 / scale, 3 / scale]} fill="rgba(14,165,233,0.05)" />
              )}
            </Layer>

            {/* Paredes */}
            <Layer>
              {walls.map(w => {
                const selected = w.id === selectedId
                return (
                  <Line key={w.id} id={w.id} points={w.pointsM.map(v => v * PX_PER_METER)}
                    stroke={selected ? '#0ea5e9' : '#e5e7eb'}
                    strokeWidth={WALL_THICKNESS_M * PX_PER_METER}
                    lineCap="round" lineJoin="round"
                    onClick={() => tool === 'select' && setSelectedId(w.id)}
                    onTap={() => tool === 'select' && setSelectedId(w.id)}
                    hitStrokeWidth={Math.max(12, WALL_THICKNESS_M * PX_PER_METER + 6)} />
                )
              })}
              {wallPreviewPx && wallPreviewPx.length >= 4 && (
                <>
                  <Line points={wallPreviewPx} stroke="#0ea5e9"
                    strokeWidth={WALL_THICKNESS_M * PX_PER_METER}
                    opacity={0.6} lineCap="round" lineJoin="round"
                    dash={[8 / scale, 4 / scale]} />
                  {pendingWall && pendingWall.length >= 2 && (() => {
                    const dots = []
                    for (let i = 0; i < pendingWall.length; i += 2)
                      dots.push(<KCircle key={i} x={pendingWall[i] * PX_PER_METER} y={pendingWall[i + 1] * PX_PER_METER} radius={5 / scale} fill="#0ea5e9" />)
                    return dots
                  })()}
                </>
              )}
            </Layer>

            {/* Círculos */}
            <Layer>
              {circles.map(c => {
                const selected = c.id === selectedId
                return (
                  <KCircle key={c.id} id={c.id}
                    x={c.cxM * PX_PER_METER} y={c.cyM * PX_PER_METER}
                    radius={c.rM * PX_PER_METER}
                    stroke={selected ? '#0ea5e9' : c.stroke}
                    strokeWidth={(selected ? 2.5 : 1.5) / scale}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(c.id)}
                    onTap={() => tool === 'select' && setSelectedId(c.id)}
                    onDragEnd={(e) => handleCircleDragEnd(c.id, e)} />
                )
              })}
              {circlePreview && circlePreview.rM > 0 && (
                <KCircle x={circlePreview.cxM * PX_PER_METER} y={circlePreview.cyM * PX_PER_METER}
                  radius={circlePreview.rM * PX_PER_METER}
                  stroke="#0ea5e9" strokeWidth={1.5 / scale} dash={[6 / scale, 3 / scale]} />
              )}
            </Layer>

            {/* Sketches */}
            <Layer>
              {sketches.map(sk => {
                const selected = sk.id === selectedId
                return (
                  <Line key={sk.id} id={sk.id} points={sk.pointsM.map(v => v * PX_PER_METER)}
                    stroke={selected ? '#0ea5e9' : sk.color}
                    strokeWidth={sk.thickness / scale}
                    tension={0.4} lineCap="round" lineJoin="round"
                    onClick={() => tool === 'select' && setSelectedId(sk.id)}
                    onTap={() => tool === 'select' && setSelectedId(sk.id)}
                    hitStrokeWidth={Math.max(12, sk.thickness + 8) / scale} />
                )
              })}
              {pendingSketch && pendingSketch.length >= 4 && (
                <Line points={pendingSketch.map(v => v * PX_PER_METER)} stroke={pencilColor}
                  strokeWidth={3 / scale} tension={0.4} lineCap="round" lineJoin="round" opacity={0.85} />
              )}
            </Layer>

            {/* Textos */}
            <Layer>
              {texts.map(t => {
                const selected = t.id === selectedId
                return (
                  <KText key={t.id} id={t.id}
                    x={t.xM * PX_PER_METER} y={t.yM * PX_PER_METER}
                    text={t.text} fontSize={14 / scale}
                    fill={selected ? '#0ea5e9' : t.color}
                    fontStyle="bold"
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(t.id)}
                    onTap={() => tool === 'select' && setSelectedId(t.id)}
                    onDragEnd={(e) => handleTextDragEnd(t.id, e)} />
                )
              })}
            </Layer>

            {/* Equipamentos */}
            <Layer>
              {shapes.map(s => {
                const selected = s.id === selectedId
                return (
                  <Group key={s.id} id={s.id} x={s.xM * PX_PER_METER} y={s.yM * PX_PER_METER}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(s.id)}
                    onTap={() => tool === 'select' && setSelectedId(s.id)}
                    onDragEnd={(e) => handleShapeDragEnd(s.id, e)}>
                    <Rect id={s.id} width={s.widthM * PX_PER_METER} height={s.heightM * PX_PER_METER}
                      fill={s.fill}
                      stroke={selected ? '#0ea5e9' : s.stroke}
                      strokeWidth={(selected ? 2.5 : 1.5) / scale}
                      cornerRadius={4 / scale}
                      shadowEnabled={selected} shadowColor="#0ea5e9"
                      shadowBlur={selected ? 10 / scale : 0} shadowOpacity={0.4} />
                    <KText text={s.label} x={6 / scale} y={6 / scale} fontSize={12 / scale} fontStyle="bold" fill={s.stroke} />
                    <KText text={`${s.widthM.toFixed(1)} × ${s.heightM.toFixed(1)} m`}
                      x={6 / scale} y={(s.heightM * PX_PER_METER) - (16 / scale)} fontSize={10 / scale} fill="#475569" />
                  </Group>
                )
              })}
            </Layer>

            {/* Distância (preview + resultado) */}
            <Layer listening={false}>
              {(distancePreview || distanceResult) && (() => {
                const d = distancePreview ?? distanceResult!
                const midX = ((d.x0 + d.x1) / 2) * PX_PER_METER
                const midY = ((d.y0 + d.y1) / 2) * PX_PER_METER
                return (
                  <>
                    <Line points={[d.x0 * PX_PER_METER, d.y0 * PX_PER_METER, d.x1 * PX_PER_METER, d.y1 * PX_PER_METER]}
                      stroke="#0ea5e9" strokeWidth={1.5 / scale} dash={[6 / scale, 3 / scale]} />
                    <KCircle x={d.x0 * PX_PER_METER} y={d.y0 * PX_PER_METER} radius={4 / scale} fill="#0ea5e9" />
                    <KCircle x={d.x1 * PX_PER_METER} y={d.y1 * PX_PER_METER} radius={4 / scale} fill="#0ea5e9" />
                    <KText x={midX + 8 / scale} y={midY - 18 / scale}
                      text={`${d.dM.toFixed(2)} m`} fontSize={13 / scale} fontStyle="bold" fill="#0ea5e9" />
                  </>
                )
              })()}
            </Layer>
          </Stage>

          {!shapes.length && !walls.length && !areas.length && !sketches.length && !circles.length && !texts.length && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-ink-muted text-[12px] bg-bg/85 px-4 py-2 rounded-md border border-border shadow-sm">
                Atalhos: S Selecionar · L Linha · R Retângulo · C Círculo · T Texto · P Lápis · D Medir · E Apagar · F8 Ortho · Z Centralizar
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
