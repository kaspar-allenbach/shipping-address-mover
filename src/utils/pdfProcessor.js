import { PDFDocument, rgb } from 'pdf-lib'

// ── pdf.js is loaded via <script> tag — no import, no Vite, no esbuild ──
const pdfjsLib = globalThis.pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

export const MM_TO_PT = 72 / 25.4
export const PT_TO_MM = 25.4 / 72

export async function loadPdfForPreview(arrayBuffer) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  return await task.promise
}

export async function getPageDimensions(pdfDoc, pageNum = 1) {
  const page = await pdfDoc.getPage(pageNum)
  const vp = page.getViewport({ scale: 1 })
  return {
    widthPt: vp.width,
    heightPt: vp.height,
    widthMm: +(vp.width * PT_TO_MM).toFixed(1),
    heightMm: +(vp.height * PT_TO_MM).toFixed(1),
  }
}

export async function renderPageToCanvas(pdfDoc, pageNum, canvas, maxWidth = 800) {
  const page = await pdfDoc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(maxWidth / base.width, 2)
  const vp = page.getViewport({ scale })

  canvas.width = vp.width
  canvas.height = vp.height

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise

  return { scale, pdfWidthPt: base.width, pdfHeightPt: base.height }
}

async function extractRegionAsImage(pdfDoc, pageNum, srcMm) {
  const page = await pdfDoc.getPage(pageNum)
  const S = 4
  const vp = page.getViewport({ scale: S })

  const full = document.createElement('canvas')
  full.width = vp.width
  full.height = vp.height
  await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise

  const cx = Math.round(srcMm.x * MM_TO_PT * S)
  const cy = Math.round(srcMm.y * MM_TO_PT * S)
  const cw = Math.round(srcMm.width * MM_TO_PT * S)
  const ch = Math.round(srcMm.height * MM_TO_PT * S)

  const crop = document.createElement('canvas')
  crop.width = cw
  crop.height = ch
  crop.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch)

  const blob = await new Promise(r => crop.toBlob(r, 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function processPdf(originalBytes, previewDoc, srcMm, dstMm, coverRect, pageNum = 1) {

  const imgBytes = await extractRegionAsImage(previewDoc, pageNum, srcMm)
  const doc = await PDFDocument.load(originalBytes)
  const page = doc.getPages()[pageNum - 1]
  const { height: H } = page.getSize()

  // white-out source area
  const sX = srcMm.x * MM_TO_PT
  const sW = srcMm.width * MM_TO_PT
  const sH = srcMm.height * MM_TO_PT
  const sY = H - (srcMm.y + srcMm.height) * MM_TO_PT

  const pad = 1
  page.drawRectangle({
    x: sX - pad, y: sY - pad,
    width: sW + 2 * pad, height: sH + 2 * pad,
    color: rgb(1, 1, 1), borderWidth: 0,
  })

  // white-out cover area (optional)
  if (coverRect) {
    page.drawRectangle({
      x:      coverRect.x * MM_TO_PT,
      y:      H - (coverRect.y + coverRect.height) * MM_TO_PT,
      width:  coverRect.width  * MM_TO_PT,
      height: coverRect.height * MM_TO_PT,
      color:  rgb(1, 1, 1),
      borderWidth: 0,
    })
  }

  // paste address at destination
  const png = await doc.embedPng(imgBytes)
  const dX = dstMm.x * MM_TO_PT
  const dY = H - (dstMm.y + srcMm.height) * MM_TO_PT
  page.drawImage(png, { x: dX, y: dY, width: sW, height: sH })

  return await doc.save()
}

