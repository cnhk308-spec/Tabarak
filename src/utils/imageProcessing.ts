import { BoundingBox } from '../types';

export function convertToWesternDigits(input: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return input
    .replace(/[٠-٩]/g, (d) => String(eastern.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
}

export function convertToEasternDigits(input: string): string {
  const eastern = '٠١٢٣٤٥٦٧٨٩';
  return input.replace(/[0-9]/g, (d) => eastern[Number(d)]);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}

export async function loadImageFile(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.readAsDataURL(file);
  });

  const img = await loadHtmlImage(rawDataUrl);
  const maxDim = 1800;
  let targetWidth = img.naturalWidth;
  let targetHeight = img.naturalHeight;

  if (targetWidth > maxDim || targetHeight > maxDim) {
    const scale = maxDim / Math.max(targetWidth, targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  // Re-encode only if oversized, otherwise preserve original quality
  if (targetWidth !== img.naturalWidth || targetHeight !== img.naturalHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return {
        dataUrl: canvas.toDataURL(outMime, 0.94),
        mimeType: outMime,
        width: targetWidth,
        height: targetHeight,
      };
    }
  }

  return {
    dataUrl: rawDataUrl,
    mimeType: file.type || 'image/jpeg',
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذر تحميل الصورة.'));
    img.src = src;
  });
}

export async function rotateImageDataUrl(
  dataUrl: string,
  degrees: 90 | -90 | 180
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadHtmlImage(dataUrl);
  const canvas = document.createElement('canvas');
  const isRightAngle = degrees === 90 || degrees === -90;
  canvas.width = isRightAngle ? img.naturalHeight : img.naturalWidth;
  canvas.height = isRightAngle ? img.naturalWidth : img.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.95),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function enhanceInkContrastDataUrl(dataUrl: string): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  // Boost contrast and slightly sharpen visual ink strokes for faded scans
  ctx.filter = 'contrast(1.45) brightness(1.06) saturate(1.15)';
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

export const TOP_RIGHT_BOX: BoundingBox = {
  ymin: 0,
  xmin: 340,
  ymax: 470,
  xmax: 1000,
};

export async function enhanceHandwritingCropDataUrl(dataUrl: string): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 4 || h < 4) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const totalPixels = w * h;

  // Build luminance histogram to stretch paper background to white and ink to deep black
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.min(
      255,
      Math.max(0, Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]))
    );
    hist[lum]++;
  }

  let acc = 0;
  let low = 0;
  let high = 255;
  const lowTarget = Math.max(1, Math.floor(totalPixels * 0.01));
  const highTarget = Math.floor(totalPixels * 0.90);

  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowTarget) {
      low = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= highTarget) {
      high = v;
      break;
    }
  }

  const range = Math.max(40, high - low);
  const stretched = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const norm = Math.min(1, Math.max(0, (data[i + c] - low) / range));
      // Mild gamma < 1 makes faint pen strokes darker while keeping white paper clean
      const boosted = norm < 0.85 ? Math.pow(norm, 1.18) : norm;
      stretched[i + c] = Math.round(boosted * 255);
    }
    stretched[i + 3] = 255;
  }

  // Gentle 3x3 sharpening pass to crisp up pen stroke hooks and dots
  const out = new Uint8ClampedArray(stretched);
  const amount = 0.22;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = stretched[idx + c];
        const neighbors =
          stretched[idx - 4 + c] +
          stretched[idx + 4 + c] +
          stretched[idx - w * 4 + c] +
          stretched[idx + w * 4 + c];
        const sharp = center * (1 + 4 * amount) - neighbors * amount;
        out[idx + c] = Math.min(255, Math.max(0, Math.round(sharp)));
      }
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function compressImageDataUrl(
  dataUrl: string,
  maxDim = 1250,
  quality = 0.85
): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  let targetW = img.naturalWidth;
  let targetH = img.naturalHeight;
  if (targetW > maxDim || targetH > maxDim) {
    const scale = maxDim / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function cropRegionDataUrl(
  dataUrl: string,
  box: BoundingBox,
  paddingNormalized = 25,
  options?: {
    minDim?: number;
    maxDim?: number;
    format?: 'image/png' | 'image/jpeg';
    quality?: number;
    contrastFilter?: boolean;
  }
): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  const ymin = Math.max(0, box.ymin - paddingNormalized);
  const xmin = Math.max(0, box.xmin - paddingNormalized);
  const ymax = Math.min(1000, box.ymax + paddingNormalized);
  const xmax = Math.min(1000, box.xmax + paddingNormalized);

  const sx = Math.floor((xmin / 1000) * img.naturalWidth);
  const sy = Math.floor((ymin / 1000) * img.naturalHeight);
  const sw = Math.max(20, Math.ceil(((xmax - xmin) / 1000) * img.naturalWidth));
  const sh = Math.max(20, Math.ceil(((ymax - ymin) / 1000) * img.naturalHeight));

  let targetW = sw;
  let targetH = sh;
  const minDim = options?.minDim;
  const maxDim = options?.maxDim;
  if (minDim && Math.max(targetW, targetH) < minDim) {
    const scale = minDim / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  } else if (maxDim && (targetW > maxDim || targetH > maxDim)) {
    const scale = maxDim / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (options?.contrastFilter) {
    ctx.filter = 'contrast(1.24) saturate(1.08)';
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  const format = options?.format ?? 'image/png';
  const quality = options?.quality ?? 0.92;
  return canvas.toDataURL(format, quality);
}

export async function generateSampleOfficialLetterFile(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 1850;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // Subtle off-white archival paper texture
  ctx.fillStyle = '#fcfbf7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle paper frame
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  ctx.strokeRect(65, 65, canvas.width - 130, canvas.height - 130);

  // Official printed letterhead (top center)
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 34px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('جمهورية العراق', canvas.width / 2, 145);
  ctx.font = 'bold 30px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('وزارة التعليم العالي والبحث العلمي', canvas.width / 2, 195);
  ctx.font = '600 24px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('دائرة الشؤون الإدارية والمالية / قسم الصادرة', canvas.width / 2, 240);

  // Divider line
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(110, 275);
  ctx.lineTo(canvas.width - 110, 275);
  ctx.stroke();

  // Printed labels on Top Right (Arabic RTL header block)
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('الـعـدد :', canvas.width - 120, 345);
  ctx.fillText('التاريـخ :', canvas.width - 120, 415);

  // Dotted printed underlines
  ctx.strokeStyle = '#94a3b8';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(canvas.width - 255, 355);
  ctx.lineTo(canvas.width - 600, 355);
  ctx.moveTo(canvas.width - 255, 425);
  ctx.lineTo(canvas.width - 600, 425);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw realistic handwritten blue-ink strokes for العدد: م/4/1285 (or ١٢٨٥/٤/م) and التاريخ: 2025/11/14
  ctx.save();
  ctx.strokeStyle = '#1d4ed8';
  ctx.fillStyle = '#1d4ed8';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Handwritten "م / ٤ / ١٢٨٥" rendered with natural pen strokes
  const drawStroke = (points: Array<[number, number]>, width = 4.2) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  // Letter م on the right (around x=1110, y=335)
  drawStroke([
    [1120, 336],
    [1112, 326],
    [1103, 334],
    [1113, 342],
    [1121, 335],
    [1100, 342],
    [1088, 343],
    [1086, 365],
  ]);
  // Slash /
  drawStroke([
    [1072, 316],
    [1055, 352],
  ]);
  // Eastern digit ٤ (around x=1025)
  drawStroke([
    [1040, 320],
    [1024, 328],
    [1039, 334],
    [1023, 342],
    [1042, 349],
  ]);
  // Slash /
  drawStroke([
    [1008, 316],
    [991, 352],
  ]);
  // Eastern digits ١٢٨٥ (from left to right: ١ ٢ ٨ ٥)
  // ١
  drawStroke([
    [912, 321],
    [914, 349],
  ]);
  // ٢
  drawStroke([
    [940, 324],
    [931, 320],
    [926, 325],
    [927, 349],
  ]);
  // ٨
  drawStroke([
    [948, 348],
    [957, 321],
    [966, 349],
  ]);
  // ٥
  drawStroke([
    [979, 324],
    [971, 335],
    [976, 347],
    [985, 343],
    [986, 330],
    [979, 324],
  ]);

  // Handwritten Date: ١٤ / ١١ / ٢٠٢٥ (with slight tilt)
  // Day: ١٤
  // ١
  drawStroke([
    [1092, 391],
    [1094, 419],
  ]);
  // ٤
  drawStroke([
    [1118, 390],
    [1104, 398],
    [1117, 405],
    [1103, 412],
    [1120, 420],
  ]);
  // Slash /
  drawStroke([
    [1078, 388],
    [1061, 423],
  ]);
  // Month: ١١
  drawStroke([
    [1044, 391],
    [1046, 419],
  ]);
  drawStroke([
    [1028, 392],
    [1030, 419],
  ]);
  // Slash /
  drawStroke([
    [1014, 388],
    [997, 423],
  ]);
  // Year: ٢٠٢٥ (left to right: ٢ ٠ ٢ ٥)
  // ٢
  drawStroke([
    [930, 393],
    [921, 389],
    [916, 394],
    [917, 418],
  ]);
  // ٠ (dot)
  ctx.beginPath();
  ctx.arc(941, 406, 4.2, 0, Math.PI * 2);
  ctx.fill();
  // ٢
  drawStroke([
    [967, 393],
    [958, 389],
    [953, 394],
    [954, 418],
  ]);
  // ٥
  drawStroke([
    [982, 394],
    [974, 405],
    [979, 417],
    [988, 413],
    [989, 400],
    [982, 394],
  ]);
  ctx.restore();

  // Official Stamp slightly near the left side of the header
  ctx.save();
  ctx.translate(320, 370);
  ctx.rotate(-0.12);
  ctx.strokeStyle = 'rgba(29, 78, 216, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(29, 78, 216, 0.55)';
  ctx.font = 'bold 18px "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('قسم الصادرة', 0, -10);
  ctx.fillText('تم التدقيق', 0, 18);
  ctx.restore();

  // Letter Body
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('إلى / كافة الجامعات والكليات الحكومية والأهلية', canvas.width - 120, 560);

  ctx.textAlign = 'center';
  ctx.font = 'bold 30px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('م / اعتماد الضوابط الإدارية والمالية للعام الدراسي', canvas.width / 2, 650);

  ctx.textAlign = 'right';
  ctx.font = '400 25px "IBM Plex Sans Arabic", sans-serif';
  const lines = [
    'تحية طيبة...',
    'استناداً إلى الصلاحيات المخولة لنا وبموجب مقتضيات المصلحة العامة، تقرر',
    'توجيه كافة التشكيلات الإدارية بالالتزام بالتعليمات المثبتة في محضر اللجنة',
    'المركزية والمصادق عليها أصولياً، وموافاتنا بتقرير الإنجاز الفصلي خلال',
    'مدة أقصاها خمسة عشر يوماً من تاريخ صدور هذا الكتاب.',
    'للتفضل بالاطلاع والعمل بموجبه... مع التقدير.',
  ];
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width - 120, 760 + i * 68);
  });

  // Signature block
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('المدير العام', 190, 1450);
  ctx.font = '400 23px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText('د. عبد الله كريم حسن', 155, 1495);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to generate sample image'));
    }, 'image/png');
  });

  return new File([blob], 'كتاب_رسمي_نموذج.png', { type: 'image/png' });
}
