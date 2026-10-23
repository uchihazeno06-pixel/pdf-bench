# PDF Bench

A small, private PDF toolkit that runs entirely in your browser. No uploads, no accounts, no server — your files never leave your device.

---

## What it does

Six tools, one tab:

- **Merge PDFs** — combine several files into one, reorder with the arrows
- **Split PDF** — extract every page as its own file, or pull out a specific range
- **Rotate PDF** — spin all pages by 90°, 180° or 270°
- **PDF → Images** — render each page as a PNG you can preview and download
- **Delete pages** — remove pages by number or range
- **Text → PDF** — paste text and turn it into a paginated PDF with your choice of page size, font, and margins

## Why I made this

Most "free online PDF tools" want you to upload your private documents to their servers, sign up, or sit through ads. I wanted a tool I could hand to a friend and say *"just open this link"* — and nothing about their files would be sent anywhere.

Everything happens locally using [`pdf-lib`](https://pdf-lib.js.org/) and [`pdf.js`](https://mozilla.github.io/pdf.js/), both running in the browser. Once the page loads, you can even disconnect from the internet and keep using it.

## Run it locally

If you want to poke at the code:

```bash
git clone https://github.com/uchihazeno06-pixel/pdf-bench.git
cd pdf-bench
python3 -m http.server 8000
