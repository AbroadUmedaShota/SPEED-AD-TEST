export const printSpec = {
  mediaWidthMm: 303,
  mediaHeightMm: 216,
  trimWidthMm: 297,
  trimHeightMm: 210,
  bleedMm: 3,
  safeMm: 5,
  foldPositionsMm: {
    outside: [97, 197],
    inside: [100, 200],
  },
  acceaTemplate: {
    widthMm: 420,
    heightMm: 350,
    bleedLeftMm: 58.5,
    bleedBottomMm: 67,
    trimLeftMm: 61.5,
    trimBottomMm: 70,
  },
};

export const printCss = `
  @page { size: 303mm 216mm; margin: 0; }
  @media print {
    html,
    body.pattern-b.print-submission {
      width: 303mm !important;
      min-width: 303mm !important;
      height: auto !important;
      background: #fff !important;
    }
    body.pattern-b.print-submission .brochure {
      display: block !important;
      width: 303mm !important;
      padding: 0 !important;
      transform: none !important;
    }
    body.pattern-b.print-submission .sheet {
      width: 303mm !important;
      height: 216mm !important;
      margin: 0 !important;
      padding: 3mm !important;
      overflow: hidden !important;
      background: #fff !important;
      box-shadow: none !important;
    }
    body.pattern-b.print-submission .panel {
      height: 210mm !important;
    }
    body.pattern-b.print-submission .sheet--outside .panel--benefits {
      height: 216mm !important;
      margin: -3mm 0 -3mm -3mm;
      padding-top: 12mm;
      padding-bottom: 9mm;
      padding-left: 10mm;
    }
    body.pattern-b.print-submission .sheet--outside .panel--cover {
      overflow: visible;
    }
    body.pattern-b.print-submission .sheet--outside .cover-gradient-card {
      right: -3mm;
      bottom: -3mm;
      min-height: 49mm;
      padding-right: 8mm;
      padding-bottom: 8mm;
    }
    body.pattern-b.print-submission .print-fold-mark,
    body.pattern-b.print-submission .print-fold-guide,
    body.pattern-b.print-submission .print-trim-guide {
      position: absolute;
      z-index: 100;
      display: block;
      pointer-events: none;
    }
    body.pattern-b.print-submission .print-fold-mark {
      width: .25mm;
      height: 1.5mm;
      background: #111;
      transform: translateX(-.125mm);
    }
    body.pattern-b.print-submission .print-fold-mark--top { top: .65mm; }
    body.pattern-b.print-submission .print-fold-mark--bottom { bottom: .65mm; }
    body.pattern-b.print-submission.print-proof .print-trim-guide {
      inset: 3mm;
      border: .25mm solid #d11a76;
    }
    body.pattern-b.print-submission.print-proof .print-fold-guide {
      top: 3mm;
      bottom: 3mm;
      width: 0;
      border-left: .25mm dashed #087f98;
      transform: translateX(-.125mm);
    }
  }
`;

export async function preparePrintPage(page, { proof = false } = {}) {
  await page.evaluate(({ css, spec, includeProof }) => {
    document.body.classList.add('print-submission');
    if (includeProof) document.body.classList.add('print-proof');
    const style = document.createElement('style');
    style.dataset.printSubmission = 'true';
    style.textContent = css;
    document.head.append(style);
    document.querySelectorAll('.sheet').forEach(sheet => {
      const side = sheet.dataset.side;
      const folds = spec.foldPositionsMm[side] || [];
      folds.forEach(trimPosition => {
        const pagePosition = spec.bleedMm + trimPosition;
        for (const edge of ['top', 'bottom']) {
          const mark = document.createElement('span');
          mark.className = `print-fold-mark print-fold-mark--${edge}`;
          mark.style.left = `${pagePosition}mm`;
          mark.setAttribute('aria-hidden', 'true');
          sheet.append(mark);
        }
        if (includeProof) {
          const guide = document.createElement('span');
          guide.className = 'print-fold-guide';
          guide.style.left = `${pagePosition}mm`;
          guide.setAttribute('aria-hidden', 'true');
          sheet.append(guide);
        }
      });
      if (includeProof) {
        const trim = document.createElement('span');
        trim.className = 'print-trim-guide';
        trim.setAttribute('aria-hidden', 'true');
        sheet.append(trim);
      }
    });
  }, { css: printCss, spec: printSpec, includeProof: proof });
  await page.evaluate(async () => { await document.fonts.ready; });
}

export async function inspectPrintLayout(page) {
  return page.evaluate(spec => {
    const pxPerMm = 96 / 25.4;
    const importantSelector = [
      '.panel h2', '.panel h3', '.panel p', '.panel address', '.panel dt', '.panel dd',
      '.panel .brand-emblem', '.panel .brand-wordmark', '.panel .contact-qr', '.panel .benefit-tags span',
    ].join(',');
    return [...document.querySelectorAll('.sheet')].map(sheet => {
      const sheetRect = sheet.getBoundingClientRect();
      const trim = {
        left: sheetRect.left + spec.bleedMm * pxPerMm,
        top: sheetRect.top + spec.bleedMm * pxPerMm,
        right: sheetRect.right - spec.bleedMm * pxPerMm,
        bottom: sheetRect.bottom - spec.bleedMm * pxPerMm,
      };
      const folds = spec.foldPositionsMm[sheet.dataset.side].map(position =>
        trim.left + position * pxPerMm);
      const elements = [...sheet.querySelectorAll(importantSelector)].filter(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      const measurements = elements.map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || element.className,
          trimDistancesMm: {
            left: (rect.left - trim.left) / pxPerMm,
            top: (rect.top - trim.top) / pxPerMm,
            right: (trim.right - rect.right) / pxPerMm,
            bottom: (trim.bottom - rect.bottom) / pxPerMm,
          },
          crossesFold: folds.some(fold => rect.left < fold && rect.right > fold),
        };
      });
      const minimumTrimDistanceMm = Math.min(...measurements.flatMap(item => Object.values(item.trimDistancesMm)));
      return {
        side: sheet.dataset.side,
        sheetMm: {
          width: Number((sheetRect.width / pxPerMm).toFixed(2)),
          height: Number((sheetRect.height / pxPerMm).toFixed(2)),
        },
        foldPositionsFromTrimMm: spec.foldPositionsMm[sheet.dataset.side],
        minimumTrimDistanceMm: Number(minimumTrimDistanceMm.toFixed(2)),
        safeAreaPass: minimumTrimDistanceMm >= spec.safeMm - 0.15,
        foldClearancePass: measurements.every(item => !item.crossesFold),
        violations: measurements.filter(item => item.crossesFold
          || Object.values(item.trimDistancesMm).some(distance => distance < spec.safeMm - 0.15)),
      };
    });
  }, printSpec);
}
