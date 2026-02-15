<script setup>
import { ref } from 'vue'

const emit = defineEmits(['files-added'])

const isDragging = ref(false)
const dragCounter = ref(0)
const fileInput = ref(null)

function onDragEnter(e) {
  e.preventDefault()
  dragCounter.value++
  isDragging.value = true
}
function onDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e) {
  e.preventDefault()
  dragCounter.value--
  if (dragCounter.value === 0) isDragging.value = false
}
function onDrop(e) {
  e.preventDefault()
  isDragging.value = false
  dragCounter.value = 0
  const pdfs = Array.from(e.dataTransfer.files).filter(
    f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  )
  if (pdfs.length) emit('files-added', pdfs)
}
function onFileSelect(e) {
  const files = Array.from(e.target.files)
  if (files.length) emit('files-added', files)
  e.target.value = ''
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ active: isDragging }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @click="fileInput?.click()"
  >
    <input
      ref="fileInput"
      type="file"
      accept=".pdf,application/pdf"
      multiple
      class="sr-only"
      @change="onFileSelect"
    />
    <div class="drop-zone-body">
      <div class="drop-icon">📄</div>
      <p v-if="isDragging">Release to upload</p>
      <p v-else>Drop PDFs here or <span class="link">browse</span></p>
      <p class="hint">Supports multiple files</p>
    </div>
  </div>
</template>

<style scoped>
.drop-zone {
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.02);
}
.drop-zone:hover {
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.04);
}
.drop-zone.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.drop-icon { font-size: 28px; margin-bottom: 6px; }
.drop-zone-body p { color: #94a3b8; font-size: 13px; margin: 0; }
.link { color: #60a5fa; text-decoration: underline; }
.hint { font-size: 11px !important; color: #64748b !important; margin-top: 4px !important; }
</style>