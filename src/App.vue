<script setup>
import { ref, computed, watch, onMounted, markRaw } from 'vue'
import DropZone from './components/DropZone.vue'
import PdfPreview from './components/PdfPreview.vue'
import { loadPdfForPreview, processPdf, getPageDimensions } from './utils/pdfProcessor.js'

// ── state ────────────────────────────────────────────────────────────
const files           = ref([])      // { name, arrayBuffer, pdfDoc, dims }
const activeIdx       = ref(-1)
const sourceRect      = ref(null)    // { x, y, width, height } mm top-left
const destPoint       = ref(null)    // { x, y } mm top-left
const mode            = ref('idle')  // idle | select-source | set-destination
const processing      = ref(false)
const progressText    = ref('')
const error           = ref('')
const pageDims        = ref(null)    // { widthMm, heightMm }

// ── computed ─────────────────────────────────────────────────────────
const activeFile  = computed(() => files.value[activeIdx.value] ?? null)
const activePdf   = computed(() => activeFile.value?.pdfDoc ?? null)
const canProcess  = computed(() => !!sourceRect.value && !!destPoint.value && files.value.length > 0)

// ── localStorage ─────────────────────────────────────────────────────
const LS_SRC = 'pdfam-src'
const LS_DST = 'pdfam-dst'

onMounted(() => {
  try {
    const s = localStorage.getItem(LS_SRC)
    const d = localStorage.getItem(LS_DST)
    if (s) sourceRect.value = JSON.parse(s)
    if (d) destPoint.value  = JSON.parse(d)
  } catch { /* ignore */ }
})

watch(sourceRect, v => { if (v) localStorage.setItem(LS_SRC, JSON.stringify(v)) }, { deep: true })
watch(destPoint,  v => { if (v) localStorage.setItem(LS_DST, JSON.stringify(v)) }, { deep: true })

// ── file handling ────────────────────────────────────────────────────
async function onFilesAdded(list) {
  error.value = ''
  for (const f of list) {
    try {
      const ab = await f.arrayBuffer()
      const doc = await loadPdfForPreview(ab.slice(0))
      const dims = await getPageDimensions(doc)
      files.value.push({
        name: f.name,
        arrayBuffer: ab,
        pdfDoc: markRaw(doc),   // ← this is the entire fix
        dims,
      })
    } catch (e) {
      console.error(e)
      error.value = `Failed to load "${f.name}": ${e.message}`
    }
  }
  if (activeIdx.value < 0 && files.value.length) selectFile(0)
}

function selectFile(i) {
  activeIdx.value = i
  pageDims.value = files.value[i]?.dims ?? null
}

function removeFile(i) {
  files.value.splice(i, 1)
  if (!files.value.length) { activeIdx.value = -1; pageDims.value = null }
  else if (activeIdx.value >= files.value.length) selectFile(files.value.length - 1)
  else if (activeIdx.value === i) selectFile(Math.min(i, files.value.length - 1))
}

function clearFiles() {
  files.value = []; activeIdx.value = -1; pageDims.value = null; error.value = ''
}

// ── events from preview ──────────────────────────────────────────────
function onSourceSelected(r)    { sourceRect.value = { ...r }; mode.value = 'idle' }
function onDestinationSet(p)    { destPoint.value  = { ...p }; mode.value = 'idle' }
function onPageInfo(info)       { pageDims.value = info }

// ── processing ───────────────────────────────────────────────────────
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function processOne(i) {
  const f = files.value[i]
  const result = await processPdf(f.arrayBuffer.slice(0), f.pdfDoc, sourceRect.value, destPoint.value)
  download(result, f.name.replace(/\.pdf$/i, '') + '-moved_address.pdf')
}

async function processCurrent() {
  if (!canProcess.value || activeIdx.value < 0) return
  processing.value = true; progressText.value = 'Processing…'; error.value = ''
  try { await processOne(activeIdx.value) }
  catch (e) { error.value = `Processing failed: ${e.message}` }
  finally { processing.value = false; progressText.value = '' }
}

async function processAll() {
  if (!canProcess.value) return
  processing.value = true; error.value = ''
  try {
    for (let i = 0; i < files.value.length; i++) {
      progressText.value = `Processing ${i + 1} / ${files.value.length}…`
      await processOne(i)
      if (i < files.value.length - 1) await new Promise(r => setTimeout(r, 400))
    }
    progressText.value = '✅ Done!'
    setTimeout(() => { progressText.value = '' }, 2500)
  } catch (e) { error.value = `Batch failed: ${e.message}` }
  finally { processing.value = false }
}

function resetSettings() {
  sourceRect.value = null; destPoint.value = null
  localStorage.removeItem(LS_SRC); localStorage.removeItem(LS_DST)
}
</script>

<template>
  <div class="app">
    <!-- ─── header ─── -->
    <header class="hdr">
      <h1>📦 PDF Address Mover</h1>
      <span class="sub">Reposition shipping addresses for Dokumenttasche</span>
    </header>

    <div class="body">
      <!-- ─── sidebar ─── -->
      <aside class="sidebar">
        <!-- upload -->
        <section class="card">
          <h2 class="card-title">Upload PDFs</h2>
          <DropZone @files-added="onFilesAdded" />

          <div v-if="files.length" class="flist">
            <div class="flist-top">
              <span class="fcount">{{ files.length }} file{{ files.length !== 1 ? 's' : '' }}</span>
              <button class="link-btn" @click="clearFiles">Clear all</button>
            </div>
            <div
              v-for="(f, i) in files" :key="i"
              class="fitem" :class="{ active: i === activeIdx }"
              @click="selectFile(i)"
            >
              <span class="fname" :title="f.name">{{ f.name }}</span>
              <span class="fdims">{{ f.dims.widthMm }}×{{ f.dims.heightMm }}</span>
              <button class="x-btn" @click.stop="removeFile(i)">×</button>
            </div>
          </div>
        </section>

        <!-- source -->
        <section class="card">
          <h2 class="card-title"><i class="dot red"></i>Source Address Area</h2>
          <p class="desc">Select where the address currently is.</p>
          <button
            class="btn outline" :class="{ on: mode === 'select-source' }"
            :disabled="!activePdf"
            @click="mode = mode === 'select-source' ? 'idle' : 'select-source'"
          >{{ mode === 'select-source' ? '✋ Drawing… (cancel)' : '✏️ Draw Rectangle' }}</button>

          <div v-if="sourceRect" class="grid4">
            <label>X<span class="iw"><input type="number" v-model.number="sourceRect.x" step="0.5" min="0"><em>mm</em></span></label>
            <label>Y<span class="iw"><input type="number" v-model.number="sourceRect.y" step="0.5" min="0"><em>mm</em></span></label>
            <label>W<span class="iw"><input type="number" v-model.number="sourceRect.width" step="0.5" min="1"><em>mm</em></span></label>
            <label>H<span class="iw"><input type="number" v-model.number="sourceRect.height" step="0.5" min="1"><em>mm</em></span></label>
          </div>
          <p v-else class="muted">No source area selected</p>
        </section>

        <!-- destination -->
        <section class="card">
          <h2 class="card-title"><i class="dot green"></i>Destination Position</h2>
          <p class="desc">Set where the address should be placed (top‑left).</p>
          <button
            class="btn outline" :class="{ on: mode === 'set-destination' }"
            :disabled="!activePdf || !sourceRect"
            @click="mode = mode === 'set-destination' ? 'idle' : 'set-destination'"
          >{{ mode === 'set-destination' ? '✋ Click on PDF… (cancel)' : '📌 Click to Place' }}</button>

          <div v-if="destPoint" class="grid4 half">
            <label>X<span class="iw"><input type="number" v-model.number="destPoint.x" step="0.5" min="0"><em>mm</em></span></label>
            <label>Y<span class="iw"><input type="number" v-model.number="destPoint.y" step="0.5" min="0"><em>mm</em></span></label>
          </div>
          <p v-else class="muted">No destination set</p>
        </section>

        <!-- page info -->
        <section v-if="pageDims" class="card compact">
          📐 Page: <strong>{{ pageDims.widthMm }} × {{ pageDims.heightMm }} mm</strong>
        </section>

        <!-- actions -->
        <section class="card">
          <h2 class="card-title">Process &amp; Download</h2>

          <button class="btn primary" :disabled="!canProcess || !activeFile || processing" @click="processCurrent">
            📥 Process Current File
          </button>
          <button v-if="files.length > 1" class="btn primary" :disabled="!canProcess || processing" @click="processAll">
            📥 Process All {{ files.length }} Files
          </button>

          <p v-if="progressText" class="progress">{{ progressText }}</p>

          <hr class="sep">
          <button class="btn ghost" @click="resetSettings">🔄 Reset Source &amp; Destination</button>
        </section>

        <div v-if="error" class="err">
          ⚠️ {{ error }}
          <button class="x-btn" @click="error = ''">×</button>
        </div>
      </aside>

      <!-- ─── preview ─── -->
      <main class="preview-area">
        <div v-if="!activePdf" class="empty">
          <span class="empty-icon">📄</span>
          <p>Upload a PDF to get started</p>
          <p class="muted small">The preview will appear here</p>
        </div>

        <template v-else>
          <div class="toolbar">
            <span class="badge" :class="mode">
              <template v-if="mode === 'select-source'">🔴 Draw a rectangle around the shipping address</template>
              <template v-else-if="mode === 'set-destination'">🟢 Click where the address should go</template>
              <template v-else>Preview — use the sidebar controls</template>
            </span>
          </div>
          <div class="scroll">
            <PdfPreview
              :pdf-doc="activePdf"
              :mode="mode"
              :source-rect="sourceRect"
              :dest-point="destPoint"
              @source-selected="onSourceSelected"
              @destination-set="onDestinationSet"
              @page-info="onPageInfo"
            />
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<style>
/* ─── layout ─── */
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.hdr {
  flex-shrink: 0; display: flex; align-items: baseline; gap: 14px;
  background: #0f172a; color: #fff; padding: 11px 20px;
  border-bottom: 1px solid #1e293b;
}
.hdr h1 { font-size: 17px; font-weight: 700; }
.sub    { font-size: 13px; color: #94a3b8; }

.body { flex: 1; display: flex; overflow: hidden; }

/* ─── sidebar ─── */
.sidebar {
  width: 340px; flex-shrink: 0; overflow-y: auto;
  background: #1e293b; color: #e2e8f0;
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
}

.card {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 8px; padding: 13px;
}
.card.compact { padding: 10px 13px; font-size: 12px; color: #94a3b8; }
.card.compact strong { color: #e2e8f0; }

.card-title {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: #cbd5e1;
  margin-bottom: 10px; display: flex; align-items: center; gap: 7px;
}
.desc { font-size: 12px; color: #94a3b8; margin-bottom: 10px; line-height: 1.4; }

.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.red   { background: #ef4444; }
.green { background: #22c55e; }

/* ─── buttons ─── */
.btn {
  display: block; width: 100%; padding: 8px 14px; border: none;
  border-radius: 6px; font-size: 13px; font-weight: 500;
  transition: all .15s; margin-bottom: 6px;
}
.btn:disabled { opacity: .35; cursor: not-allowed; }

.outline {
  background: transparent; color: #e2e8f0;
  border: 1px solid rgba(255,255,255,.13);
}
.outline:hover:not(:disabled) { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.22); }
.outline.on { background: rgba(59,130,246,.14); border-color: #3b82f6; color: #60a5fa; }

.primary { background: #3b82f6; color: #fff; }
.primary:hover:not(:disabled) { background: #2563eb; }

.ghost { background: transparent; color: #94a3b8; }
.ghost:hover:not(:disabled) { color: #e2e8f0; background: rgba(255,255,255,.04); }

.link-btn { background: none; border: none; color: #60a5fa; font-size: 12px; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.x-btn {
  background: none; border: none; color: #94a3b8;
  font-size: 16px; padding: 0 4px; line-height: 1;
}
.x-btn:hover { color: #ef4444; }

/* ─── file list ─── */
.flist { margin-top: 10px; }
.flist-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fcount { font-size: 12px; color: #94a3b8; }

.fitem {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 5px;
  cursor: pointer; font-size: 12px; transition: background .12s;
}
.fitem:hover { background: rgba(255,255,255,.05); }
.fitem.active { background: rgba(59,130,246,.14); }
.fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fdims { font-size: 10px; color: #64748b; flex-shrink: 0; }

/* ─── coordinate inputs ─── */
.grid4 {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 7px; margin-top: 10px;
}
.grid4.half { grid-template-columns: 1fr 1fr; } /* same, but only 2 items */

.grid4 label {
  font-size: 10px; color: #94a3b8;
  text-transform: uppercase; letter-spacing: .5px;
}

.iw {
  display: flex; margin-top: 3px;
  background: rgba(0,0,0,.2); border: 1px solid rgba(255,255,255,.08);
  border-radius: 4px; overflow: hidden;
}
.iw:focus-within { border-color: #3b82f6; }

.iw input {
  flex: 1; width: 100%; background: transparent; border: none;
  color: #e2e8f0; padding: 5px 7px; font-size: 13px; outline: none;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}
.iw em { font-style: normal; font-size: 11px; color: #64748b; padding-right: 7px; align-self: center; }

.muted { font-size: 12px; color: #64748b; font-style: italic; margin-top: 8px; }

.sep { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 4px 0; }

.progress { font-size: 12px; color: #60a5fa; text-align: center; padding: 4px 0; }

.err {
  background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.25);
  border-radius: 6px; padding: 9px 11px; font-size: 12px; color: #fca5a5;
  display: flex; align-items: flex-start; gap: 8px;
}

/* ─── preview area ─── */
.preview-area {
  flex: 1; overflow: hidden; display: flex; flex-direction: column;
  background: #f1f5f9;
}

.empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: #94a3b8;
}
.empty-icon { font-size: 48px; margin-bottom: 14px; opacity: .5; }
.empty p { font-size: 16px; }
.small { font-size: 13px !important; margin-top: 4px; }

.toolbar {
  flex-shrink: 0; padding: 10px 20px;
  background: #fff; border-bottom: 1px solid #e2e8f0;
}
.badge { font-size: 13px; font-weight: 500; color: #64748b; }
.badge.select-source   { color: #ef4444; }
.badge.set-destination  { color: #16a34a; }

.scroll { flex: 1; overflow: auto; padding: 20px; }

/* ─── responsive ─── */
@media (max-width: 900px) {
  .body { flex-direction: column; }
  .sidebar { width: 100%; max-height: 45vh; }
  .sub { display: none; }
}
</style>