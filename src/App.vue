<script setup>
import { ref, computed, watch, onMounted, markRaw, nextTick } from 'vue'
import DropZone from './components/DropZone.vue'
import PdfPreview from './components/PdfPreview.vue'
import { loadPdfForPreview, processPdf, getPageDimensions } from './utils/pdfProcessor.js'

const files           = ref([])
const activeIdx       = ref(-1)
const sourceRect      = ref(null)
const destPoint       = ref(null)
const coverRect       = ref(null)
const mode            = ref('idle')
const processing      = ref(false)
const progressText    = ref('')
const error           = ref('')
const pageDims        = ref(null)
let syncing = false

const activeFile      = computed(() => files.value[activeIdx.value] ?? null)
const activePdf       = computed(() => activeFile.value?.pdfDoc ?? null)
const canProcess      = computed(() => { const f = activeFile.value; return f && f.sourceRect && f.destPoint })
const filesReadyCount = computed(() => files.value.filter(f => f.sourceRect && f.destPoint).length)

const showFoldMarks = ref(JSON.parse(localStorage.getItem('pdfam-fold') ?? 'false'))

// ── localStorage ──
const LS_SRC = 'pdfam-src'
const LS_DST = 'pdfam-dst'
const LS_COV = 'pdfam-cov'

onMounted(() => {
  try {
    const s = localStorage.getItem(LS_SRC)
    const d = localStorage.getItem(LS_DST)
    const c = localStorage.getItem(LS_COV)
    if (s) sourceRect.value = JSON.parse(s)
    if (d) destPoint.value  = JSON.parse(d)
    if (c) coverRect.value  = JSON.parse(c)
  } catch {}
})

watch(sourceRect, v => {
  if (syncing) return
  if (activeFile.value) activeFile.value.sourceRect = v ? { ...v } : null
  if (v) localStorage.setItem(LS_SRC, JSON.stringify(v))
}, { deep: true })

watch(destPoint, v => {
  if (syncing) return
  if (activeFile.value) activeFile.value.destPoint = v ? { ...v } : null
  if (v) localStorage.setItem(LS_DST, JSON.stringify(v))
}, { deep: true })

watch(coverRect, v => {
  if (syncing) return
  if (activeFile.value) activeFile.value.coverRect = v ? { ...v } : null
  if (v) localStorage.setItem(LS_COV, JSON.stringify(v))
  else localStorage.removeItem(LS_COV)
}, { deep: true })

// ── files ──
async function onFilesAdded(list) {
  error.value = ''
  const dSrc = sourceRect.value ? { ...sourceRect.value } : null
  const dDst = destPoint.value  ? { ...destPoint.value }  : null
  const dCov = coverRect.value  ? { ...coverRect.value }  : null
  for (const f of list) {
    try {
      const ab = await f.arrayBuffer()
      const doc = await loadPdfForPreview(ab.slice(0))
      const dims = await getPageDimensions(doc)
      files.value.push({
        name: f.name, arrayBuffer: ab, pdfDoc: markRaw(doc), dims,
        sourceRect: dSrc ? { ...dSrc } : null,
        destPoint:  dDst ? { ...dDst } : null,
        coverRect:  dCov ? { ...dCov } : null,
      })
    } catch (e) { console.error(e); error.value = `Failed to load "${f.name}": ${e.message}` }
  }
  if (activeIdx.value < 0 && files.value.length) selectFile(0)
}

function selectFile(i) {
  syncing = true; activeIdx.value = i
  const f = files.value[i]
  pageDims.value   = f?.dims       ?? null
  sourceRect.value = f?.sourceRect ? { ...f.sourceRect } : null
  destPoint.value  = f?.destPoint  ? { ...f.destPoint }  : null
  coverRect.value  = f?.coverRect  ? { ...f.coverRect }  : null
  nextTick(() => { syncing = false })
}

function removeFile(i) {
  files.value.splice(i, 1)
  if (!files.value.length) {
    activeIdx.value = -1; pageDims.value = null; syncing = true
    sourceRect.value = null; destPoint.value = null; coverRect.value = null
    nextTick(() => { syncing = false })
  } else if (activeIdx.value >= files.value.length) selectFile(files.value.length - 1)
  else if (activeIdx.value === i) selectFile(Math.min(i, files.value.length - 1))
}

function clearFiles() { files.value = []; activeIdx.value = -1; pageDims.value = null; error.value = '' }

function applyToAll() {
  files.value.forEach(f => {
    f.sourceRect = sourceRect.value ? { ...sourceRect.value } : null
    f.destPoint  = destPoint.value  ? { ...destPoint.value }  : null
    f.coverRect  = coverRect.value  ? { ...coverRect.value }  : null
  })
}

// ── events ──
function onSourceSelected(r) { sourceRect.value = { ...r }; mode.value = 'idle' }
function onDestinationSet(p) { destPoint.value  = { ...p }; mode.value = 'idle' }
function onCoverSelected(r)  { coverRect.value  = { ...r }; mode.value = 'idle' }
function onPageInfo(info)    { pageDims.value = info }

function clearCover() {
  coverRect.value = null
  if (activeFile.value) activeFile.value.coverRect = null
  localStorage.removeItem(LS_COV)
}

// ── processing ──
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function processOne(i) {
  const f = files.value[i]
  if (!f.sourceRect || !f.destPoint) throw new Error(`"${f.name}" has no source or destination set`)
  const result = await processPdf(
    f.arrayBuffer.slice(0),
    f.pdfDoc,
    f.sourceRect,
    f.destPoint,
    f.coverRect,
    1,
    showFoldMarks.value   // ← the ref, not f.showFoldMarks
  )
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
  const ready = files.value.map((f, i) => ({ f, i })).filter(({ f }) => f.sourceRect && f.destPoint)
  if (!ready.length) return
  processing.value = true; error.value = ''
  try {
    for (let j = 0; j < ready.length; j++) {
      progressText.value = `Processing ${j + 1} / ${ready.length}…`
      await processOne(ready[j].i)
      if (j < ready.length - 1) await new Promise(r => setTimeout(r, 400))
    }
    progressText.value = '✅ Done!'
    setTimeout(() => { progressText.value = '' }, 2500)
  } catch (e) { error.value = `Batch failed: ${e.message}` }
  finally { processing.value = false }
}

function resetSettings() {
  sourceRect.value = null; destPoint.value = null; coverRect.value = null
  if (activeFile.value) {
    activeFile.value.sourceRect = null; activeFile.value.destPoint = null; activeFile.value.coverRect = null
  }
  localStorage.removeItem(LS_SRC); localStorage.removeItem(LS_DST); localStorage.removeItem(LS_COV)
}
</script>

<template>
  <div class="app">
    <header class="hdr">
      <img src="./assets/logo.svg" alt="" class="kaspar-logo">
      <h1>Kaspars PDF Address Mover</h1>
      <span class="sub">Reposition shipping addresses for Packing Slips. So you can use <a href="https://shop.post.ch/de/verpacken-versenden/paketversand/dokumententaschen-c6-5-150-stk-080560/p/560652?eqrecqid=89aab231-0a9b-11f1-83e5-000074caec6e">these bad boys</a>.</span>
    </header>

    <div class="body">
      <aside class="sidebar">
        <!-- upload -->
        <section class="card">
          <h2 class="card-title">Upload PDFs</h2>
          <DropZone @files-added="onFilesAdded" />
          <div v-if="files.length" class="flist">
            <div class="flist-top">
              <span class="fcount">{{ filesReadyCount }}/{{ files.length }} ready</span>
              <button class="link-btn" @click="clearFiles">Clear all</button>
            </div>
            <div v-for="(f, i) in files" :key="i"
                 class="fitem" :class="{ active: i === activeIdx }" @click="selectFile(i)">
              <span class="fstatus">{{ f.sourceRect && f.destPoint ? '✅' : '⚠️' }}</span>
              <span class="fname" :title="f.name">{{ f.name }}</span>
              <span class="fdims">{{ f.dims.widthMm }}×{{ f.dims.heightMm }}</span>
              <button class="x-btn" @click.stop="removeFile(i)">×</button>
            </div>
          </div>
        </section>

        <!-- source -->
        <section class="card">
          <h2 class="card-title"><i class="dot red"></i>Source Address Area</h2>
          <p class="desc">Select where the address currently is on this PDF.</p>
          <button class="btn outline" :class="{ on: mode === 'select-source' }" :disabled="!activePdf"
                  @click="mode = mode === 'select-source' ? 'idle' : 'select-source'">
            {{ mode === 'select-source' ? '✋ Drawing… (cancel)' : '✏️ Draw Rectangle' }}
          </button>
          <div v-if="sourceRect" class="grid4">
            <label>X<span class="iw"><input type="number" v-model.number="sourceRect.x" step="0.5" min="0"><em>mm</em></span></label>
            <label>Y<span class="iw"><input type="number" v-model.number="sourceRect.y" step="0.5" min="0"><em>mm</em></span></label>
            <label>W<span class="iw"><input type="number" v-model.number="sourceRect.width" step="0.5" min="1"><em>mm</em></span></label>
            <label>H<span class="iw"><input type="number" v-model.number="sourceRect.height" step="0.5" min="1"><em>mm</em></span></label>
          </div>
          <p v-else class="muted">No source area selected</p>
          <button v-if="files.length > 1 && sourceRect" class="btn ghost small" @click="applyToAll">
            📋 Apply current coords to all files
          </button>
        </section>

        <!-- destination -->
        <section class="card">
          <h2 class="card-title"><i class="dot green"></i>Destination Position</h2>
          <p class="desc">Set where the address should be placed (top‑left).</p>
          <button class="btn outline" :class="{ on: mode === 'set-destination' }"
                  :disabled="!activePdf || !sourceRect"
                  @click="mode = mode === 'set-destination' ? 'idle' : 'set-destination'">
            {{ mode === 'set-destination' ? '✋ Click on PDF… (cancel)' : '📌 Click to Place' }}
          </button>
          <div v-if="destPoint" class="grid4 half">
            <label>X<span class="iw"><input type="number" v-model.number="destPoint.x" step="0.5" min="0"><em>mm</em></span></label>
            <label>Y<span class="iw"><input type="number" v-model.number="destPoint.y" step="0.5" min="0"><em>mm</em></span></label>
          </div>
          <p v-else class="muted">No destination set</p>
        </section>

        <!-- cover -->
        <section class="card">
          <h2 class="card-title"><i class="dot cover-dot"></i>White-Out Cover</h2>
          <p class="desc">Optionally draw a white rectangle to hide overlapping text or lines.</p>
          <button class="btn outline" :class="{ on: mode === 'select-cover' }" :disabled="!activePdf"
                  @click="mode = mode === 'select-cover' ? 'idle' : 'select-cover'">
            {{ mode === 'select-cover' ? '✋ Drawing… (cancel)' : '⬜ Draw Cover Area' }}
          </button>
          <div v-if="coverRect" class="grid4">
            <label>X<span class="iw"><input type="number" v-model.number="coverRect.x" step="0.5" min="0"><em>mm</em></span></label>
            <label>Y<span class="iw"><input type="number" v-model.number="coverRect.y" step="0.5" min="0"><em>mm</em></span></label>
            <label>W<span class="iw"><input type="number" v-model.number="coverRect.width" step="0.5" min="1"><em>mm</em></span></label>
            <label>H<span class="iw"><input type="number" v-model.number="coverRect.height" step="0.5" min="1"><em>mm</em></span></label>
          </div>
          <p v-else class="muted">No cover area set (optional)</p>
          <button v-if="coverRect" class="btn ghost small" @click="clearCover">🗑️ Remove cover</button>
        </section>

        <!-- page info -->
        <section v-if="pageDims" class="card compact">
          📐 Page: <strong>{{ pageDims.widthMm }} × {{ pageDims.heightMm }} mm</strong>
        </section>

        <!-- actions -->
        <section class="card">
          <h2 class="card-title">Process &amp; Download</h2>
          <button class="btn primary" :disabled="!canProcess || processing" @click="processCurrent">
            📥 Process Current File
          </button>
          <button v-if="files.length > 1" class="btn primary"
                  :disabled="filesReadyCount === 0 || processing" @click="processAll">
            📥 Process {{ filesReadyCount }} Ready File{{ filesReadyCount !== 1 ? 's' : '' }}
          </button>
          <p v-if="progressText" class="progress">{{ progressText }}</p>
          <hr class="sep">
          <button class="btn ghost" @click="resetSettings">🔄 Reset All Settings</button>
        </section>
        <section v-if="pageDims" class="card compact" style="display:flex;align-items:center;gap:8px;">
          <button class="btn outline small" :class="{ on: showFoldMarks }"
                  @click="showFoldMarks = !showFoldMarks" style="margin:0;width:auto;">
            {{ showFoldMarks ? '✅' : '▫️' }} DIN lang fold marks
          </button>
        </section>
        <div v-if="error" class="err">
          ⚠️ {{ error }}
          <button class="x-btn" @click="error = ''">×</button>
        </div>
        <div class="card">
          <h2 class="card-title">Info</h2>
          <ul>
            <li>Made for the  <a href="https://www.supportyourlocalartist.ch/en">Support your local Artist Shop</a></li>
            <li>Made by <a href="https://www.supportyourlocalartist.ch/collections/kaspar-allenbach">Kaspar Allenbach</a></li>
            <li>This shit is vibecoded so beware! <a href="https://github.com/kaspar-allenbach/shipping-address-mover">Contribute</a></li>
            <li>It is made for the Fullfilment Guru Plugin of Shopify but works on every PDF. So you can Use it for any shipping label!</li>
            <li>All actions are made in your Browser (no data is sent to any server)</li>
            <li>Your settings and coordinates will be saved in your Browser so once you have your coordinates you can just push your PDF's trough the gauntlet.</li>
          </ul>
          
        </div>
      </aside>

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
              <template v-else-if="mode === 'select-cover'">⬜ Draw a white-out cover rectangle</template>
              <template v-else>Preview — use the sidebar controls</template>
            </span>
          </div>
          <div class="scroll">
            <PdfPreview
              :pdf-doc="activePdf"
              :mode="mode"
              :show-fold-marks="showFoldMarks"
              :source-rect="sourceRect"
              :dest-point="destPoint"
              :cover-rect="coverRect"
              @source-selected="onSourceSelected"
              @destination-set="onDestinationSet"
              @cover-selected="onCoverSelected"
              @page-info="onPageInfo"
            />
          </div>
        </template>
      </main>
    </div>
  </div>
</template>


<style>
/* ─── color tokens ─── */
:root {
  /* base palette */
  --c-bg-dark:       #292a2d;
  --c-bg-sidebar:    var(--c-bg-dark);
  --c-bg-preview:    #f1f5f9;
  --c-bg-card:       rgba(255,255,255,.04);
  --c-bg-input:      rgba(0,0,0,.2);
  --c-bg-white:      #fff;

  /* borders */
  --c-border-dark:   #1e293b;
  --c-border-card:   rgba(255,255,255,.06);
  --c-border-input:  rgba(255,255,255,.08);
  --c-border-light:  #e2e8f0;
  --c-border-hover:  rgba(255,255,255,.22);
  --c-border-subtle: rgba(255,255,255,.13);

  /* text */
  --c-text-primary:  #e2e8f0;
  --c-text-heading:  #cbd5e1;
  --c-text-muted:    #94a3b8;
  --c-text-dim:      #64748b;
  --c-text-white:    #fff;
  --c-cover:    #94a3b8;
--c-cover-bg: rgba(255, 255, 255, .65);



  /* accent */
  --c-accent:        #3b82f6;
  --c-accent-hover:  #2563eb;
  --c-accent-soft:   rgba(59,130,246,.14);
  --c-accent-link:   #60a5fa;

  /* semantic */
  --c-red:           #ef4444;
  --c-red-soft:      rgba(239,68,68,.12);
  --c-red-border:    rgba(239,68,68,.25);
  --c-red-text:      #fca5a5;
  --c-green:         #22c55e;
  --c-green-dark:    #16a34a;

  /* interactive overlays */
  --c-hover-overlay: rgba(255,255,255,.06);
  --c-hover-faint:   rgba(255,255,255,.05);
  --c-ghost-hover:   rgba(255,255,255,.04);
}

/* ─── layout ─── */
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.hdr {
  flex-shrink: 0; display: flex; align-items: center; gap: 14px;
  background: var(--c-bg-dark); color: var(--c-text-white); padding: 11px 20px;
  border-bottom: 1px solid var(--c-border-dark);
}
.hdr .kaspar-logo { width: 32px; height: 32px; }
.hdr h1 { font-size: 17px; font-weight: 700; }
.sub    { font-size: 13px; color: var(--c-text-muted); }

.body { flex: 1; display: flex; overflow: hidden; }

/* ─── sidebar ─── */
.sidebar {
  width: 340px; flex-shrink: 0; overflow-y: auto;
  background: var(--c-bg-sidebar); color: var(--c-text-primary);
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
}

.card {
  background: var(--c-bg-card);
  border: 1px solid var(--c-border-card);
  border-radius: 8px; padding: 13px;
}
.card.compact { padding: 10px 13px; font-size: 12px; color: var(--c-text-muted); }
.card.compact strong { color: var(--c-text-primary); }
aside a, header a { color: var(--c-accent-link); }
.card-title {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; color: var(--c-text-heading);
  margin-bottom: 10px; display: flex; align-items: center; gap: 7px;
}
.desc { font-size: 12px; color: var(--c-text-muted); margin-bottom: 10px; line-height: 1.4; }
ul { padding-left: 18px; margin-left: 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.red   { background: var(--c-red); }
.green { background: var(--c-green); }
/* add after the other .dot rules */
.cover-dot {
  background: var(--c-text-white);
  box-shadow: inset 0 0 0 1.5px var(--c-cover);
}
.badge.select-cover { color: var(--c-cover); }
/* ─── buttons ─── */
.btn {
  display: block; width: 100%; padding: 8px 14px; border: none;
  border-radius: 6px; font-size: 13px; font-weight: 500;
  transition: all .15s; margin-bottom: 6px; cursor: pointer;
}
.btn:disabled { opacity: .35; cursor: not-allowed; }

.outline {
  background: transparent; color: var(--c-text-primary);
  border: 1px solid var(--c-border-subtle);
}
.outline:hover:not(:disabled) { background: var(--c-hover-overlay); border-color: var(--c-border-hover); }
.outline.on { background: var(--c-accent-soft); border-color: var(--c-accent); color: var(--c-accent-link); }

.primary { background: var(--c-accent); color: var(--c-text-white); }
.primary:hover:not(:disabled) { background: var(--c-accent-hover); }

.ghost { background: transparent; color: var(--c-text-muted); }
.ghost:hover:not(:disabled) { color: var(--c-text-primary); background: var(--c-ghost-hover); }

.link-btn { background: none; border: none; color: var(--c-accent-link); font-size: 12px; padding: 0; cursor: pointer; }
.link-btn:hover { text-decoration: underline; }

.x-btn {
  background: none; border: none; color: var(--c-text-muted);
  font-size: 16px; padding: 0 4px; line-height: 1; cursor: pointer;
}
.x-btn:hover { color: var(--c-red); }

/* ─── file list ─── */
.flist { margin-top: 10px; }
.flist-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fcount { font-size: 12px; color: var(--c-text-muted); }

.fitem {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 5px;
  cursor: pointer; font-size: 12px; transition: background .12s;
}
.fitem:hover { background: var(--c-hover-faint); }
.fitem.active { background: var(--c-accent-soft); }
.fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fdims { font-size: 10px; color: var(--c-text-dim); flex-shrink: 0; }
.fstatus { flex-shrink: 0; font-size: 12px; }

/* ─── coordinate inputs ─── */
.grid4 {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 7px; margin-top: 10px;
}
.grid4.half { grid-template-columns: 1fr 1fr; }

.grid4 label {
  font-size: 10px; color: var(--c-text-muted);
  text-transform: uppercase; letter-spacing: .5px;
}

.iw {
  display: flex; margin-top: 3px;
  background: var(--c-bg-input); border: 1px solid var(--c-border-input);
  border-radius: 4px; overflow: hidden;
}
.iw:focus-within { border-color: var(--c-accent); }

.iw input {
  flex: 1; width: 100%; background: transparent; border: none;
  color: var(--c-text-primary); padding: 5px 7px; font-size: 13px; outline: none;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}
.iw em { font-style: normal; font-size: 11px; color: var(--c-text-dim); padding-right: 7px; align-self: center; }

.muted { font-size: 12px; color: var(--c-text-dim); font-style: italic; margin-top: 8px; }

.sep { border: none; border-top: 1px solid var(--c-border-card); margin: 4px 0; }

.progress { font-size: 12px; color: var(--c-accent-link); text-align: center; padding: 4px 0; }

.err {
  background: var(--c-red-soft); border: 1px solid var(--c-red-border);
  border-radius: 6px; padding: 9px 11px; font-size: 12px; color: var(--c-red-text);
  display: flex; align-items: flex-start; gap: 8px;
}

/* ─── preview area ─── */
.preview-area {
  flex: 1; overflow: hidden; display: flex; flex-direction: column;
  background: var(--c-bg-preview);
}

.empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; color: var(--c-text-muted);
}
.empty-icon { font-size: 48px; margin-bottom: 14px; opacity: .5; }
.empty p { font-size: 16px; }
.small { font-size: 11px !important; margin-top: 6px !important; }

.toolbar {
  flex-shrink: 0; padding: 10px 20px;
  background: var(--c-bg-white); border-bottom: 1px solid var(--c-border-light);
}
.badge { font-size: 13px; font-weight: 500; color: var(--c-text-dim); }
.badge.select-source  { color: var(--c-red); }
.badge.set-destination { color: var(--c-green-dark); }

.scroll { flex: 1; overflow: auto; padding: 20px; }

/* ─── responsive ─── */
@media (max-width: 900px) {
  .body { flex-direction: column; }
  .sidebar { width: 100%; max-height: 45vh; }
  .sub { display: none; }
}
</style>
