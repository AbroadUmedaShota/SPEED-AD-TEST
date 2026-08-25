import { commandStart, getEditablePoints, movePoint, parsePathData, serializePathData, splitSubpaths } from './pathData.js';
import { presets } from './presets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_RADII = { anchor: 2, control: 1.6 };
const NODE_SCALES = { small: 1, medium: 1.45, large: 1.9 };
const savedNodeSize = window.localStorage.getItem('logoSvgEditorNodeSize');
const initialNodeSize = Object.hasOwn(NODE_SCALES, savedNodeSize) ? savedNodeSize : 'small';
const elements = Object.fromEntries(['presetSelect', 'loadPresetButton', 'resetButton', 'svgFile', 'dropZone', 'pathList', 'canvas', 'emptyMessage', 'nodeList', 'selectionSummary', 'coordinateSection', 'pointTitle', 'xInput', 'yInput', 'lineButton', 'curveButton', 'undoButton', 'redoButton', 'zoomInButton', 'zoomOutButton', 'fitButton', 'nodesButton', 'nodeSizeSelect', 'downloadButton', 'status', 'toast'].map((id) => [id, document.getElementById(id)]));
const state = { document: null, filename: '', sourceText: '', paths: [], selected: null, selectedPoint: null, history: [], historyIndex: -1, zoom: 1, showNodes: true, nodeSize: initialNodeSize, drag: null };

function notify(message) { elements.toast.textContent = message; elements.toast.classList.add('is-visible'); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 3200); }
function sanitizeSvg(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('有効なSVGファイルではありません。');
  root.querySelectorAll('script, foreignObject, style, animate, animateMotion, animateTransform, set, discard').forEach((node) => node.remove());
  [root, ...root.querySelectorAll('*')].forEach((node) => [...node.attributes].forEach((attribute) => {
    const name = attribute.name.toLowerCase(); const value = attribute.value.trim();
    if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && value && !value.startsWith('#')) || /url\s*\(/i.test(value)) node.removeAttribute(attribute.name);
  }));
  return root;
}
function collectPaths(documentRoot) {
  const pathElements = [...documentRoot.querySelectorAll('path')];
  if (pathElements.some((element) => element.closest('[transform]'))) {
    throw new Error('transform付きのパスには対応していません。transformを展開してから読み込んでください。');
  }
  return pathElements.map((element, pathIndex) => ({ element, pathIndex, commands: parsePathData(element.getAttribute('d')), fill: element.getAttribute('fill') || '#808080' }));
}
function snapshot() { return state.paths.map(({ element }) => element.getAttribute('d')); }
function saveHistory() { state.history = state.history.slice(0, state.historyIndex + 1); state.history.push(snapshot()); state.historyIndex += 1; updateControls(); }
function restoreHistory(index) { state.historyIndex = index; state.paths.forEach((path, pathIndex) => { path.element.setAttribute('d', state.history[index][pathIndex]); path.commands = parsePathData(state.history[index][pathIndex]); }); render(); updateControls(); }
function updateControls() { const hasSvg = Boolean(state.document); elements.undoButton.disabled = state.historyIndex <= 0; elements.redoButton.disabled = state.historyIndex < 0 || state.historyIndex >= state.history.length - 1; elements.resetButton.disabled = !hasSvg; elements.downloadButton.disabled = !hasSvg; elements.nodesButton.setAttribute('aria-pressed', String(state.showNodes)); elements.nodesButton.textContent = `ノード表示: ${state.showNodes ? 'ON' : 'OFF'}`; elements.status.textContent = hasSvg ? `${state.filename}.svg / ${state.historyIndex > 0 ? '変更あり' : '未変更'} / ${selectionLabel()} / ${Math.round(state.zoom * 100)}%` : 'SVGを読み込んでください'; }
function selectionLabel() { return state.selected ? `パス ${state.selected.pathIndex + 1}・サブパス ${state.selected.subpathIndex + 1}` : '未選択'; }
function getSubpath(selection = state.selected) { if (!selection) return null; const path = state.paths[selection.pathIndex]; return splitSubpaths(path.commands)[selection.subpathIndex]; }
function getCanvasViewBox(root) {
  const values = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return '0 0 1000 600';
  const [x, y, width, height] = values;
  const padding = state.showNodes ? Math.max(width, height) * .045 : 0;
  return `${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}`;
}
function render() {
  elements.canvas.replaceChildren();
  elements.emptyMessage.hidden = Boolean(state.document);
  if (!state.document) return;
  const root = state.document.cloneNode(true); root.querySelectorAll('path').forEach((path, index) => path.setAttribute('data-path-index', index));
  [...root.children].forEach((child) => elements.canvas.append(child));
  elements.canvas.setAttribute('viewBox', getCanvasViewBox(root));
  elements.canvas.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  elements.canvas.style.transform = `scale(${state.zoom})`; elements.canvas.style.transformOrigin = 'center';
  state.paths.forEach((path) => splitSubpaths(path.commands).forEach((subpath, subpathIndex) => {
    const hit = document.createElementNS(SVG_NS, 'path'); hit.setAttribute('d', serializePathData(subpath.commands)); hit.classList.add('subpath-hit'); hit.dataset.pathIndex = path.pathIndex; hit.dataset.subpathIndex = subpathIndex; hit.setAttribute('tabindex', '0'); hit.setAttribute('aria-label', `パス ${path.pathIndex + 1}、サブパス ${subpathIndex + 1}`); elements.canvas.append(hit);
  }));
  if (state.showNodes && state.selected) renderNodes();
  renderLists(); updateInspector(); updateControls();
}
function renderNodes() {
  const path = state.paths[state.selected.pathIndex]; const subpath = getSubpath(); if (!path || !subpath) return;
  subpath.commands.forEach((command, localIndex) => {
    const commandIndex = subpath.start + localIndex; const start = commandStart(path.commands, commandIndex);
    if (command.type === 'C' && start) { [[start.x, start.y, command.x1, command.y1], [command.x, command.y, command.x2, command.y2]].forEach(([x1, y1, x2, y2]) => { const line = document.createElementNS(SVG_NS, 'line'); line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', x2); line.setAttribute('y2', y2); line.classList.add('control-line'); elements.canvas.append(line); }); }
    getEditablePoints(command).forEach((point) => {
      const scale = NODE_SCALES[state.nodeSize];
      const radius = (point.key === 'anchor' ? NODE_RADII.anchor : NODE_RADII.control) * scale;
      const selected = state.selectedPoint?.commandIndex === commandIndex && state.selectedPoint?.key === point.key;
      const hitTarget = document.createElementNS(SVG_NS, 'circle');
      const circle = document.createElementNS(SVG_NS, 'circle');
      [hitTarget, circle].forEach((node) => {
        node.setAttribute('cx', point.x);
        node.setAttribute('cy', point.y);
      });
      hitTarget.setAttribute('r', Math.max(radius + 2.2, 4.2));
      hitTarget.classList.add('node-hit-target');
      hitTarget.dataset.commandIndex = commandIndex;
      hitTarget.dataset.pointKey = point.key;
      hitTarget.setAttribute('tabindex', '0');
      hitTarget.setAttribute('aria-label', `${point.label} ${commandIndex + 1}`);
      hitTarget.setAttribute('aria-current', String(selected));
      circle.setAttribute('r', radius);
      circle.classList.add(point.key === 'anchor' ? 'node-anchor' : 'node-control');
      if (selected) circle.classList.add('node-selected');
      elements.canvas.append(hitTarget, circle);
    });
  });
}
function renderLists() {
  elements.pathList.replaceChildren(); state.paths.forEach((path) => splitSubpaths(path.commands).forEach((_, subpathIndex) => { const item = document.createElement('li'); const button = document.createElement('button'); const active = state.selected?.pathIndex === path.pathIndex && state.selected?.subpathIndex === subpathIndex; const swatch = document.createElement('span'); button.type = 'button'; button.dataset.pathIndex = path.pathIndex; button.dataset.subpathIndex = subpathIndex; button.setAttribute('aria-pressed', String(active)); swatch.className = 'color-swatch'; swatch.setAttribute('aria-hidden', 'true'); swatch.style.backgroundColor = CSS.supports('color', path.fill) ? path.fill : '#808080'; button.append(swatch, document.createTextNode(`パス ${path.pathIndex + 1} / ${subpathIndex + 1}`)); item.append(button); elements.pathList.append(item); }));
  elements.nodeList.replaceChildren(); const subpath = getSubpath(); if (!subpath) return; const path = state.paths[state.selected.pathIndex]; subpath.commands.forEach((command, localIndex) => getEditablePoints(command).forEach((point) => { const commandIndex = subpath.start + localIndex; const item = document.createElement('li'); const button = document.createElement('button'); const active = state.selectedPoint?.commandIndex === commandIndex && state.selectedPoint?.key === point.key; button.type = 'button'; button.dataset.commandIndex = commandIndex; button.dataset.pointKey = point.key; button.setAttribute('aria-pressed', String(active)); button.textContent = `${point.label} ${commandIndex + 1}: (${point.x}, ${point.y})`; item.append(button); elements.nodeList.append(item); }));
}
function updateInspector() { const path = state.selected && state.paths[state.selected.pathIndex]; const point = state.selectedPoint && getEditablePoints(path.commands[state.selectedPoint.commandIndex]).find((item) => item.key === state.selectedPoint.key); elements.selectionSummary.textContent = state.selected ? selectionLabel() : '未選択'; elements.coordinateSection.hidden = !point; if (!point) return; elements.pointTitle.textContent = `${point.label}の座標`; elements.xInput.value = point.x; elements.yInput.value = point.y; const command = path.commands[state.selectedPoint.commandIndex]; const convertible = command.type === 'L' || command.type === 'C'; elements.lineButton.disabled = !convertible || command.type === 'L'; elements.curveButton.disabled = !convertible || command.type === 'C'; }
function select(pathIndex, subpathIndex, commandIndex = null, pointKey = 'anchor') { state.selected = { pathIndex: Number(pathIndex), subpathIndex: Number(subpathIndex) }; const subpath = getSubpath(); const first = commandIndex ?? subpath.commands.findIndex((command) => command.type === 'M' || command.type === 'L' || command.type === 'C') + subpath.start; state.selectedPoint = first >= subpath.start ? { commandIndex: Number(first), key: pointKey } : null; render(); }
function svgPoint(event) { const point = elements.canvas.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; return point.matrixTransform(elements.canvas.getScreenCTM().inverse()); }
function editSelectedPoint(x, y, record = true) { if (!state.selectedPoint) return; const path = state.paths[state.selected.pathIndex]; movePoint(path.commands[state.selectedPoint.commandIndex], state.selectedPoint.key, x, y); path.element.setAttribute('d', serializePathData(path.commands)); if (record) saveHistory(); render(); }
function loadSvg(text, filename) { const nextDocument = sanitizeSvg(text); const nextPaths = collectPaths(nextDocument); if (!nextPaths.length) throw new Error('編集可能なpath要素がありません。'); state.document = nextDocument; state.filename = filename.replace(/\.svg$/i, '') || 'logo'; state.sourceText = text; state.paths = nextPaths; state.selected = null; state.selectedPoint = null; state.history = []; state.historyIndex = -1; state.zoom = 1; saveHistory(); render(); notify(`${filename} を読み込みました。`); }
async function loadPreset() {
  const preset = presets.find((item) => item.id === elements.presetSelect.value);
  if (!preset) return;
  elements.loadPresetButton.disabled = true;
  try {
    const response = await fetch(encodeURI(preset.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`確定SVGを読み込めませんでした（${response.status}）。`);
    loadSvg(await response.text(), preset.filename);
  } catch (error) {
    notify(`${error.message} HTTPサーバーで起動しているか確認してください。`);
  } finally {
    elements.loadPresetButton.disabled = false;
  }
}
function download() { const clone = state.document.cloneNode(true); const content = new XMLSerializer().serializeToString(clone); const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${content}`], { type: 'image/svg+xml' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.filename || 'logo'}-edited.svg`; link.click(); URL.revokeObjectURL(link.href); }
function convertSegment(type) { if (!state.selectedPoint) return; const path = state.paths[state.selected.pathIndex]; const index = state.selectedPoint.commandIndex; const command = path.commands[index]; const start = commandStart(path.commands, index); if (!start || (type === 'line' && command.type !== 'C') || (type === 'curve' && command.type !== 'L')) return; if (type === 'line') path.commands[index] = { type: 'L', x: command.x, y: command.y }; else path.commands[index] = { type: 'C', x1: start.x + (command.x - start.x) / 3, y1: start.y + (command.y - start.y) / 3, x2: start.x + (command.x - start.x) * 2 / 3, y2: start.y + (command.y - start.y) * 2 / 3, x: command.x, y: command.y }; path.element.setAttribute('d', serializePathData(path.commands)); saveHistory(); render(); }

elements.svgFile.addEventListener('change', async (event) => { const file = event.target.files[0]; if (file) { try { loadSvg(await file.text(), file.name); } catch (error) { notify(error.message); } } });
elements.loadPresetButton.addEventListener('click', loadPreset);
elements.presetSelect.addEventListener('change', loadPreset);
elements.resetButton.addEventListener('click', () => { if (state.sourceText) loadSvg(state.sourceText, `${state.filename}.svg`); });
['dragenter', 'dragover'].forEach((name) => elements.dropZone.addEventListener(name, (event) => { event.preventDefault(); elements.dropZone.classList.add('is-dragging'); })); ['dragleave', 'drop'].forEach((name) => elements.dropZone.addEventListener(name, (event) => { event.preventDefault(); elements.dropZone.classList.remove('is-dragging'); })); elements.dropZone.addEventListener('drop', async (event) => { const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith('.svg') || item.type === 'image/svg+xml'); if (!file) return notify('SVGファイルをドロップしてください。'); try { loadSvg(await file.text(), file.name); } catch (error) { notify(error.message); } });
elements.pathList.addEventListener('click', (event) => { const button = event.target.closest('button[data-path-index]'); if (button) select(button.dataset.pathIndex, button.dataset.subpathIndex); }); elements.nodeList.addEventListener('click', (event) => { const button = event.target.closest('button[data-command-index]'); if (button) { state.selectedPoint = { commandIndex: Number(button.dataset.commandIndex), key: button.dataset.pointKey }; render(); } });
elements.canvas.addEventListener('click', (event) => { const hit = event.target.closest('.subpath-hit'); const node = event.target.closest('[data-command-index]'); if (node) { state.selectedPoint = { commandIndex: Number(node.dataset.commandIndex), key: node.dataset.pointKey }; render(); } else if (hit) select(hit.dataset.pathIndex, hit.dataset.subpathIndex); }); elements.canvas.addEventListener('pointerdown', (event) => { const node = event.target.closest('[data-command-index]'); if (!node) return; state.selectedPoint = { commandIndex: Number(node.dataset.commandIndex), key: node.dataset.pointKey }; state.drag = { changed: false }; elements.canvas.setPointerCapture(event.pointerId); event.preventDefault(); }); elements.canvas.addEventListener('pointermove', (event) => { if (state.drag) { const point = svgPoint(event); state.drag.changed = true; editSelectedPoint(point.x, point.y, false); } }); elements.canvas.addEventListener('pointerup', () => { if (state.drag) { const changed = state.drag.changed; state.drag = null; if (changed) saveHistory(); render(); } });
['xInput', 'yInput'].forEach((id) => elements[id].addEventListener('change', () => { const x = Number(elements.xInput.value); const y = Number(elements.yInput.value); if (Number.isFinite(x) && Number.isFinite(y)) editSelectedPoint(x, y); })); elements.undoButton.addEventListener('click', () => restoreHistory(state.historyIndex - 1)); elements.redoButton.addEventListener('click', () => restoreHistory(state.historyIndex + 1)); elements.zoomInButton.addEventListener('click', () => { state.zoom = Math.min(3, state.zoom + .15); render(); }); elements.zoomOutButton.addEventListener('click', () => { state.zoom = Math.max(.3, state.zoom - .15); render(); }); elements.fitButton.addEventListener('click', () => { state.zoom = 1; render(); }); elements.nodesButton.addEventListener('click', () => { state.showNodes = !state.showNodes; render(); }); elements.nodeSizeSelect.addEventListener('change', () => { state.nodeSize = elements.nodeSizeSelect.value; window.localStorage.setItem('logoSvgEditorNodeSize', state.nodeSize); render(); }); elements.lineButton.addEventListener('click', () => convertSegment('line')); elements.curveButton.addEventListener('click', () => convertSegment('curve')); elements.downloadButton.addEventListener('click', download);
window.addEventListener('keydown', (event) => { const formTarget = event.target.matches('input, textarea, select, [contenteditable="true"]'); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { if (formTarget) return; event.preventDefault(); if (event.shiftKey) { if (!elements.redoButton.disabled) restoreHistory(state.historyIndex + 1); } else if (!elements.undoButton.disabled) restoreHistory(state.historyIndex - 1); return; } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { if (formTarget) return; event.preventDefault(); if (!elements.redoButton.disabled) restoreHistory(state.historyIndex + 1); return; } if (formTarget || !state.selectedPoint || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const point = getEditablePoints(state.paths[state.selected.pathIndex].commands[state.selectedPoint.commandIndex]).find((item) => item.key === state.selectedPoint.key); const step = event.shiftKey ? 10 : 1; editSelectedPoint(point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)); });
presets.forEach((preset) => {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = preset.label;
  elements.presetSelect.append(option);
});
elements.nodeSizeSelect.value = state.nodeSize;
updateControls();
loadPreset();
