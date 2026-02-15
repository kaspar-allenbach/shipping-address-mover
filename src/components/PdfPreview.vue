<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { renderPageToCanvas, MM_TO_PT, PT_TO_MM } from '../utils/pdfProcessor.js'

const props = defineProps({
  pdfDoc:     { type: Object, default: null },
  mode:       { type: String, default: 'idle' },
  sourceRect: { type: Object, default: null },
  destPoint:  { type: Object, default: null },
})
const emit = defineEmits(['source-selected', 'destination-set', 'page-info'])

// ── core refs ──
const container   = ref(null)
const pdfCanvas   = ref(null)
const renderInfo  = ref(null)
const isRendering = ref(false)
const mousePos    = ref(null)

// drawing state (select-source mode)
const isDrawing   = ref(false)
const drawStart   = ref(null)
const drawCurrent = ref(null)

// drag / resize state (idle mode)
const isDragging  = ref(false)
const dragState   = ref(null) // { type, which, handle, startX, startY, orig }
const dragRect    = ref(null) // { which, left, top, width, height } px

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR  = {
  nw: 'nw-resize', n: 'ns-resize', ne: 'ne-resize', e: 'ew-resize',
  se: 'se-resize', s: 'ns-resize', sw: 'sw-resize', w: 'ew-resize',
}

// ── computed ──
const isIdle         = computed(() => props.mode === 'idle' && !isDrawing.value)
const isInteractMode = computed(() => props.mode === 'select-source' || props.mode === 'set-destination')

// helpers
const mmToPx = mm => renderInfo.value ? mm * MM_TO_PT * renderInfo.value.scale : 0
const pxToMm = px => renderInfo.value
  ? Math.round(px / renderInfo.value.scale * PT_TO_MM * 10) / 10 : 0

function canvasCoords(e) {
  if (!pdfCanvas.value) return { x: 0, y: 0 }
  const r = pdfCanvas.value.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
    y: Math.max(0, Math.min(e.clientY - r.top,  r.height)),
  }
}

// pixel rects from props
const srcPx = computed(() => {
  const s = props.sourceRect
  if (!s || !renderInfo.value) return null
  return { left: mmToPx(s.x), top: mmToPx(s.y), width: mmToPx(s.width), height: mmToPx(s.height) }
})
const dstPx = computed(() => {
  const d = props.destPoint, s = props.sourceRect
  if (!d || !s || !renderInfo.value) return null
  return { left: mmToPx(d.x), top: mmToPx(d.y), width: mmToPx(s.width), height: mmToPx(s.height) }
})

// display styles — use drag override while dragging, otherwise props
const toCSS = r => r
  ? { left: r.left+'px', top: r.top+'px', width: r.width+'px', height: r.height+'px' }
  : null

const srcStyle  = computed(() => toCSS(dragRect.value?.which === 'source' ? dragRect.value : srcPx.value))
const dstStyle  = computed(() => toCSS(dragRect.value?.which === 'dest'   ? dragRect.value : dstPx.value))
const drawStyle = computed(() => {
  if (!isDrawing.value || !drawStart.value || !drawCurrent.value) return null
  const x = Math.min(drawStart.value.x, drawCurrent.value.x)
  const y = Math.min(drawStart.value.y, drawCurrent.value.y)
  return {
    left: x+'px', top: y+'px',
    width:  Math.abs(drawCurrent.value.x - drawStart.value.x)+'px',
    height: Math.abs(drawCurrent.value.y - drawStart.value.y)+'px',
  }
})

// ── rendering ──
async function render() {
  if (!props.pdfDoc || !pdfCanvas.value || !container.value) return
  isRendering.value = true
  try {
    const maxW = Math.max(400, Math.min(container.value.clientWidth - 40, 1400))
    const info = await renderPageToCanvas(props.pdfDoc, 1, pdfCanvas.value, maxW)
    renderInfo.value = info
    emit('page-info', {
      widthMm:  +(info.pdfWidthPt  * PT_TO_MM).toFixed(1),
      heightMm: +(info.pdfHeightPt * PT_TO_MM).toFixed(1),
    })
  } catch (err) { console.error('Render failed', err) }
  finally { isRendering.value = false }
}

watch(() => props.pdfDoc, async () => { await nextTick(); render() })
let rTimer = null
const onResize = () => { clearTimeout(rTimer); rTimer = setTimeout(render, 200) }
onMounted(async () => { await nextTick(); if (props.pdfDoc) render(); window.addEventListener('resize', onResize) })
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onDrawMove)
  window.removeEventListener('mouseup',   onDrawUp)
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup',   onDragEnd)
  clearTimeout(rTimer)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

// ── drawing (select-source / set-destination) ──
function onInteractDown(e) {
  if (props.mode === 'select-source') {
    const c = canvasCoords(e)
    isDrawing.value = true
    drawStart.value = c; drawCurrent.value = { ...c }
    window.addEventListener('mousemove', onDrawMove)
    window.addEventListener('mouseup',   onDrawUp)
  } else if (props.mode === 'set-destination') {
    const c = canvasCoords(e)
    emit('destination-set', { x: pxToMm(c.x), y: pxToMm(c.y) })
  }
}
function onDrawMove(e) { if (isDrawing.value) drawCurrent.value = canvasCoords(e) }
function onDrawUp() {
  if (isDrawing.value) {
    isDrawing.value = false
    if (drawStart.value && drawCurrent.value) {
      const x1 = Math.min(drawStart.value.x, drawCurrent.value.x)
      const y1 = Math.min(drawStart.value.y, drawCurrent.value.y)
      const x2 = Math.max(drawStart.value.x, drawCurrent.value.x)
      const y2 = Math.max(drawStart.value.y, drawCurrent.value.y)
      if (x2 - x1 > 10 && y2 - y1 > 10)
        emit('source-selected', { x: pxToMm(x1), y: pxToMm(y1), width: pxToMm(x2-x1), height: pxToMm(y2-y1) })
    }
    drawStart.value = drawCurrent.value = null
  }
  window.removeEventListener('mousemove', onDrawMove)
  window.removeEventListener('mouseup',   onDrawUp)
}

// ── drag & resize (idle mode) ──
function onRectDown(which, e) {
  if (!isIdle.value) return
  startDrag(which, 'move', null, e)
}
function onHandleDown(which, handle, e) {
  if (!isIdle.value) return
  startDrag(which, 'resize', handle, e)
}

function startDrag(which, type, handle, e) {
  const c    = canvasCoords(e)
  const orig = { ...(which === 'source' ? srcPx.value : dstPx.value) }

  isDragging.value = true
  dragState.value  = { type, which, handle, startX: c.x, startY: c.y, orig }
  dragRect.value   = { which, ...orig }

  document.body.style.cursor     = handle ? CURSOR[handle] : 'move'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup',   onDragEnd)
}

function onDragMove(e) {
  const ds = dragState.value; if (!ds) return
  const c  = canvasCoords(e)
  const dx = c.x - ds.startX
  const dy = c.y - ds.startY
  let { left, top, width, height } = ds.orig

  if (ds.type === 'move') {
    left += dx; top += dy
  } else {
    const h = ds.handle
    if (h.includes('w')) { left += dx; width  -= dx }
    if (h.includes('e')) {              width  += dx }
    if (h.includes('n')) { top  += dy; height -= dy }
    if (h.includes('s')) {              height += dy }
  }

  // enforce minimum size
  const MIN = 10
  if (width  < MIN) { width  = MIN; if (ds.handle?.includes('w')) left = ds.orig.left + ds.orig.width  - MIN }
  if (height < MIN) { height = MIN; if (ds.handle?.includes('n')) top  = ds.orig.top  + ds.orig.height - MIN }

  // clamp to canvas
  const cw = pdfCanvas.value?.width  ?? 9999
  const ch = pdfCanvas.value?.height ?? 9999
  left = Math.max(0, Math.min(left, cw - width))
  top  = Math.max(0, Math.min(top,  ch - height))

  dragRect.value = { which: ds.which, left, top, width, height }
}

function onDragEnd() {
  const r = dragRect.value
  if (r) {
    if (r.which === 'source')
      emit('source-selected', { x: pxToMm(r.left), y: pxToMm(r.top), width: pxToMm(r.width), height: pxToMm(r.height) })
    else
      emit('destination-set', { x: pxToMm(r.left), y: pxToMm(r.top) })
  }
  isDragging.value = false; dragState.value = null; dragRect.value = null
  document.body.style.cursor = ''; document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup',   onDragEnd)
}

// ── hover readout ──
function onHover(e) {
  if (isDragging.value || isDrawing.value || !renderInfo.value) return
  const c = canvasCoords(e)
  mousePos.value = { x: pxToMm(c.x), y: pxToMm(c.y) }
}
</script>

<template>
  <div ref="container" class="preview">
    <div v-if="isRendering" class="loading">Rendering…</div>

    <div v-show="!isRendering" class="canvas-wrap"
         @mousemove="onHover" @mouseleave="mousePos = null">
      <canvas ref="pdfCanvas"></canvas>

      <!-- ── source rectangle ── -->
      <div v-if="srcStyle"
           class="rect src" :class="{ interactive: isIdle }" :style="srcStyle"
           @mousedown.prevent="onRectDown('source', $event)">
        <span class="lbl lbl-src">Source</span>
        <template v-if="isIdle">
          <div v-for="h in HANDLES" :key="h"
               class="handle src-handle" :data-pos="h"
               @mousedown.stop.prevent="onHandleDown('source', h, $event)"></div>
        </template>
      </div>

      <!-- ── destination rectangle ── -->
      <div v-if="dstStyle"
           class="rect dst" :class="{ interactive: isIdle }" :style="dstStyle"
           @mousedown.prevent="onRectDown('dest', $event)">
        <span class="lbl lbl-dst">Destination</span>
      </div>

      <!-- ── drawing rect (while drawing new source) ── -->
      <div v-if="drawStyle" class="rect drawing" :style="drawStyle"></div>

      <!-- ── interaction layer (draw / click modes only) ── -->
      <div class="interact"
           :class="{
             active: isInteractMode,
             'c-cross': mode === 'select-source',
             'c-ptr':   mode === 'set-destination',
           }"
           @mousedown="onInteractDown"></div>
    </div>

    <div v-if="mousePos && !isRendering && !isDragging" class="coord-badge">
      {{ mousePos.x }}&thinsp;×&thinsp;{{ mousePos.y }}&thinsp;mm
    </div>
  </div>
</template>

<style scoped>
.preview { width: 100%; position: relative; }
.loading { display: flex; align-items: center; justify-content: center; padding: 80px; color: #94a3b8; }

.canvas-wrap {
  position: relative; display: inline-block;
  box-shadow: 0 4px 24px rgba(0,0,0,.12);
}
.canvas-wrap canvas { display: block; border-radius: 4px; }

/* ── interaction layer ── */
.interact { position: absolute; inset: 0; z-index: 10; pointer-events: none; }
.interact.active { pointer-events: auto; z-index: 20; }
.c-cross { cursor: crosshair; }
.c-ptr   { cursor: pointer; }

/* ── rectangles ── */
.rect { position: absolute; pointer-events: none; z-index: 5; border-radius: 2px; }
.rect.interactive { pointer-events: auto; z-index: 15; cursor: move; }
.rect.drawing { z-index: 25; }

.src     { border: 2px dashed #ef4444; background: rgba(239,68,68,.08); }
.dst     { border: 2px dashed #22c55e; background: rgba(34,197,94,.08); }
.drawing { border: 2px dashed #3b82f6; background: rgba(59,130,246,.08); }

/* ── labels ── */
.lbl {
  position: absolute; top: -22px; left: -2px;
  font-size: 10px; font-weight: 700; padding: 2px 7px;
  border-radius: 3px 3px 0 0; white-space: nowrap;
  letter-spacing: .5px; text-transform: uppercase; pointer-events: none;
}
.lbl-src { background: #ef4444; color: #fff; }
.lbl-dst { background: #22c55e; color: #fff; }

/* ── resize handles (source only) ── */
.handle {
  position: absolute; width: 10px; height: 10px;
  background: #fff; border: 2px solid #ef4444; border-radius: 2px;
  transform: translate(-50%, -50%);
  z-index: 2; pointer-events: auto;
  transition: transform .1s, box-shadow .1s;
}
.handle:hover {
  transform: translate(-50%, -50%) scale(1.3);
  box-shadow: 0 0 6px rgba(239,68,68,.45);
}

.handle[data-pos="nw"] { top: 0;    left: 0;    cursor: nw-resize; }
.handle[data-pos="n"]  { top: 0;    left: 50%;  cursor: ns-resize; }
.handle[data-pos="ne"] { top: 0;    left: 100%; cursor: ne-resize; }
.handle[data-pos="e"]  { top: 50%;  left: 100%; cursor: ew-resize; }
.handle[data-pos="se"] { top: 100%; left: 100%; cursor: se-resize; }
.handle[data-pos="s"]  { top: 100%; left: 50%;  cursor: ns-resize; }
.handle[data-pos="sw"] { top: 100%; left: 0;    cursor: sw-resize; }
.handle[data-pos="w"]  { top: 50%;  left: 0;    cursor: ew-resize; }

/* ── coord badge ── */
.coord-badge {
  position: absolute; bottom: 10px; right: 10px;
  background: rgba(0,0,0,.72); color: #fff;
  padding: 4px 10px; border-radius: 4px;
  font-size: 12px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  pointer-events: none; z-index: 30;
}
</style>