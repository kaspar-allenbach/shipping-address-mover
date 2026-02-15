

# 📦 PDF Address Mover

Client-side web app to reposition shipping addresses on order PDFs for correct
Dokumenttasche window placement.

## Features

- **Drag & drop** single or multiple PDFs
- **Visual source selection** — draw a rectangle around the address
- **Visual destination placement** — click where the address should go
- **Fine-tune coordinates** via mm inputs (saved to localStorage)
- **Batch processing** — process all files in one click
- **100 % client-side** — no data leaves your browser
- Downloads with `-moved_address` suffix

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:5173

Deploy to GitHub Pages

    Update base in vite.config.js to match your repo name
    Run:

npm run deploy

How it works

    Upload order PDF(s)
    Click Draw Rectangle and select the shipping address area (red)
    Click Click to Place and click the correct position (green)
    Adjust coordinates in the number inputs if needed
    Click Process & Download

The app renders the source region at 4× resolution, whites out the original,
and embeds the captured image at the destination using pdf-lib.
Tech

Vue 3 · Vite · pdf.js · pdf-lib · ES 2022+


</details>

---

## Setup & Run

```bash
# 1. Create the project and copy all files above into the structure

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev

# 4. Build for production
npm run build

# 5. Deploy to GitHub Pages (change `base` in vite.config.js first!)
npm run deploy

Workflow at a glance
Step	Action	Result
1	Drop PDF(s) onto the upload zone	Files appear in sidebar list; first PDF renders in preview
2	Click ✏️ Draw Rectangle → drag on the preview	Red dashed "Source" overlay appears
3	Click 📌 Click to Place → click on the preview	Green dashed "Destination" overlay appears
4	Fine-tune X/Y/W/H in the sidebar inputs	Overlays update in real-time
5	Click Process Current or Process All	Modified PDF(s) download with -moved_address suffix

Coordinates persist in localStorage — close the browser, reopen, and your settings are still there. Perfect for repeated batch runs from Order Fulfillment Guru. 🚀