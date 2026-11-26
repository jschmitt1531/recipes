// Reading recipes out of photos (OCR) and Word documents, plus image compression.
// Heavy libraries load only when first used.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Could not load a helper library. Check your internet connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be opened. Try a JPG or PNG.')); i.src = src; });
}

// Resize + JPEG-compress so photos sync quickly and fit the free database plan.
export async function compressImage(fileOrDataUrl, maxSide = 1400, quality = 0.78) {
  const src = typeof fileOrDataUrl === 'string' ? fileOrDataUrl : await readAsDataURL(fileOrDataUrl);
  const img = await loadImage(src);
  let { width: w, height: h } = img;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let q = quality, out = c.toDataURL('image/jpeg', q);
  while (out.length > 850000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
  return out;
}

// Grayscale + contrast boost helps OCR on phone photos of recipe cards.
async function prepForOcr(file) {
  const img = await loadImage(await readAsDataURL(file));
  const maxSide = 2200;
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) { const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; px[i] = px[i + 1] = px[i + 2] = g; sum += g; }
  const mean = sum / (px.length / 4);
  for (let i = 0; i < px.length; i += 4) { const v = Math.max(0, Math.min(255, (px[i] - mean) * 1.6 + 150)); px[i] = px[i + 1] = px[i + 2] = v; }
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function ocrImage(file, onProgress) {
  onProgress && onProgress(0, 'Loading the text reader…');
  await loadScript(TESSERACT);
  const canvas = await prepForOcr(file);
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress, 'Reading the recipe…'); },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally { worker.terminate(); }
}

export async function readWordFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.doc') && !name.endsWith('.docx')) {
    throw new Error('This is an older Word file (.doc). Open it in Word or Google Docs and "Save as" .docx, then try again.');
  }
  await loadScript(MAMMOTH);
  const buf = await file.arrayBuffer();
  const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
  // mammoth separates paragraphs with blank lines; keep single breaks between short lines.
  return res.value.replace(/\n{2,}/g, '\n').replace(/\n(?=\S[^\n]{60,})/g, '\n\n');
}

export async function readTextFile(file) { return file.text(); }
