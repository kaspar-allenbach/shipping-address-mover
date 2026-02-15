<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { renderPageToCanvas, MM_TO_PT, PT_TO_MM } from '../utils/pdfProcessor.js'

const props = defineProps({
  pdfDoc:    { type: Object, default: null },
  mode:      { type: String, default: 'idle' },
  sourceRect:{ type: Object, default: null },
  destPoint: { type: Object, default: null },
})

const emit = defineEmits(['source-selected', 'destination-set', 'page-info'])

// ── refs ──
const container = ref(null)
const pdfCanvas = ref(null)
const renderInfo = ref(null)   // { scale, pdfWidthPt, pdfHeightPt }
const isRendering = ref(false)

// drawing state
const isDrawing = ref(false)
const drawStart = ref(null)
const drawCurrent = ref(null)
const mousePos = ref(null)     // mm readout

// ── helpers ──
const mmToPx = (mm) => renderInfo.value ? mm * MM_TO_PT * renderInfo.value.scale : 0
const pxToMm = (px) => renderInfo.value
  ? Math.round((px / renderInfo.value.scale * PT_TO_MM) * 10) / 10
  : 0

function canvasCoords(e) {
  if (!pdfCanvas.value) return { x: 0, y: 0 }
  const r = pdfCanvas.value.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
    y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
  }
}

// ── overlay rectangles (CSS positioned) ──
function rectStyle(xMm, yMm, wMm, hMm) {
  return {
    left:   mmToPx(xMm) + 'px',
    top:    mmToPx(yMm) + 'px',
    width:  mmToPx(wMm) + 'px',
    height: mmToPx(hMm) + 'px',
  }
}

const srcStyle = computed(() => {
  const s = props.sourceRect
  if (!s || !renderInfo.value || isDrawing.value) return null
  return rectStyle(s.x, s.y, s.width, s.height)
})

const dstStyle = computed(() => {
  const d = props.destPoint
  const s = props.sourceRect
  if (!d || !s || !renderInfo.value) return null
  return rectStyle(d.x, d.y, s.width, s.height)
})

const drawStyle = computed(() => {
  if (!isDrawing.value || !drawStart.value || !drawCurrent.value) return null
  const x = Math.min(drawStart.value.x, drawCurrent.value.x)
  const y = Math.min(drawStart.value.y, drawCurrent.value.y)
  const w = Math.abs(drawCurrent.value.x - drawStart.value.x)
  const h = Math.abs(drawCurrent.value.y - drawStart.value.y)
  return { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }
})

const cursorClass = computed(() => {
  if (props.mode === 'select-source')    return 'cursor-crosshair'
  if (props.mode === 'set-destination')  return 'cursor-target'
  return ''
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
  } catch (err) {
    console.error('Render failed', err)
  } finally {
    isRendering.value = false
  }
}

watch(() => props.pdfDoc, async () => { await nextTick(); render() })

let resizeTimer = null
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200) }

onMounted(async () => {
  await nextTick()
  if (props.pdfDoc) render()
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', globalMove)
  window.removeEventListener('mouseup', globalUp)
  clearTimeout(resizeTimer)
})

// ── mouse interaction ──
function onMouseDown(e) {
  if (props.mode === 'select-source') {
    const c = canvasCoords(e)
    isDrawing.value = true
    drawStart.value = c
    drawCurrent.value = { ...c }
    window.addEventListener('mousemove', globalMove)
    window.addEventListener('mouseup', globalUp)
  } else if (props.mode === 'set-destination') {
    const c = canvasCoords(e)
    emit('destination-set', { x: pxToMm(c.x), y: pxToMm(c.y) })
  }
}

function globalMove(e) {
  if (isDrawing.value) drawCurrent.value = canvasCoords(e)
}

function globalUp() {
  if (isDrawing.value) {
    isDrawing.value = false
    if (drawStart.value && drawCurrent.value) {
      const x1 = Math.min(drawStart.value.x, drawCurrent.value.x)
      const y1 = Math.min(drawStart.value.y, drawCurrent.value.y)
      const x2 = Math.max(drawStart.value.x, drawCurrent.value.x)
      const y2 = Math.max(drawStart.value.y, drawCurrent.value.y)
      if (x2 - x1 > 10 && y2 - y1 > 10) {
        emit('source-selected', {
          x: pxToMm(x1), y: pxToMm(y1),
          width: pxToMm(x2 - x1), height: pxToMm(y2 - y1),
        })
      }
    }
    drawStart.value = null
    drawCurrent.value = null
  }
  window.removeEventListener('mousemove', globalMove)
  window.removeEventListener('mouseup', globalUp)
}

function onLocalMove(e) {
  if (!renderInfo.value) return
  const c = canvasCoords(e)
  mousePos.value = { x: pxToMm(c.x), y: pxToMm(c.y) }
}
function onLeave() { mousePos.value = null }
</script>

<template>
  <div ref="container" class="preview">
    <div v-if="isRendering" class="loading">Rendering…</div>

    <div v-show="!isRendering" class="canvas-wrap" :class="cursorClass">
      <canvas ref="pdfCanvas"></canvas>

      <!-- source overlay -->
      <div v-if="srcStyle" class="rect src" :style="srcStyle">
        <span class="lbl lbl-src">Source</span>
      </div>

      <!-- destination overlay -->
      <div v-if="dstStyle" class="rect dst" :style="dstStyle">
        <span class="lbl lbl-dst">Destination</span>
      </div>

      <!-- live drawing rectangle -->
      <div v-if="drawStyle" class="rect drawing" :style="drawStyle"></div>

      <!-- transparent interaction layer (on top) -->
      <div
        class="interact"
        @mousedown="onMouseDown"
        @mousemove="onLocalMove"
        @mouseleave="onLeave"
      ></div>
    </div>

    <div v-if="mousePos && !isRendering" class="coord-badge">
      {{ mousePos.x }}&thinsp;×&thinsp;{{ mousePos.y }}&thinsp;mm
    </div>
  </div>
</template>

<style scoped>
.preview { width: 100%; position: relative; }

.loading {
  display: flex; align-items: center; justify-content: center;
  padding: 80px; color: #94a3b8; font-size: 15px;
}

.canvas-wrap {
  position: relative; display: inline-block;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  border-radius: 4px; overflow: hidden;
}
.canvas-wrap canvas { display: block; }

.cursor-crosshair, .cursor-crosshair .interact { cursor: crosshair; }
.cursor-target,    .cursor-target .interact    { cursor: pointer; }

.interact { position: absolute; inset: 0; z-index: 10; }

/* ── overlay rectangles ── */
.rect {
  position: absolute; pointer-events: none; z-index: 5;
  border-radius: 2px;
}
.src     { border: 2px dashed #ef4444; background: rgba(239,68,68,.08); }
.dst     { border: 2px dashed #22c55e; background: rgba(34,197,94,.08); }
.drawing { border: 2px dashed #3b82f6; background: rgba(59,130,246,.08); }

.lbl {
  position: absolute; top: -22px; left: -2px;
  font-size: 10px; font-weight: 700; padding: 2px 7px;
  border-radius: 3px 3px 0 0; white-space: nowrap;
  letter-spacing: .5px; text-transform: uppercase;
}
.lbl-src { background: #ef4444; color: #fff; }
.lbl-dst { background: #22c55e; color: #fff; }

.coord-badge {
  position: absolute; bottom: 10px; right: 10px;
  background: rgba(0,0,0,.72); color: #fff;
  padding: 4px 10px; border-radius: 4px;
  font-size: 12px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  pointer-events: none; z-index: 20;
}
</style>