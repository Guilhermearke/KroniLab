/**
 * Studio: regua de compassos, cifras, lane de click, lane de guia e uma lane
 * colorida por stem com a waveform desenhada dentro.
 *
 * A waveform vem de computePeaks() sobre as notas reais do arranjo. Nada aqui e
 * desenho decorativo: se a bateria nao toca na ponte, a lane fica vazia la.
 */
import { timeOfBar } from '@kronilab/core';
import { computePeaks, type Arrangement } from './arrangement.ts';
import {
  CLICK_COLOR, GUIDE_COLOR, STEMS, chordAtBar, chordName,
  type DemoSong, type StemKey,
} from './data.ts';

/**
 * Largura de um compasso, em pixels, no zoom 1.
 * Calibrada para caber ~16 compassos na largura de um celular: o operador
 * precisa ver a FORMA da musica, nao quatro compassos ampliados.
 */
const BASE_BAR_WIDTH = 26;

/** Alturas das lanes. No celular precisam caber os 8 stems na mesma tela. */
function laneHeights() {
  const compact = window.innerWidth < 760;
  return { click: compact ? 44 : 56, guide: compact ? 40 : 50, stem: compact ? 52 : 68 };
}

export interface TimelineHandles {
  root: HTMLElement;
  setZoom(zoom: number): void;
  zoom(): number;
  pixelsPerSecond(): number;
  redraw(): void;
}

export function renderTimeline(
  container: HTMLElement,
  song: DemoSong,
  arrangement: Arrangement,
  onSectionClick: (sectionId: string) => void,
): TimelineHandles {
  let zoom = 1;
  const totalBars = song.sections[song.sections.length - 1]!.endBar - 1;
  const key = song.selectedKey ?? song.originalKey;

  container.innerHTML = '';
  const scroller = el('div', 'tl-scroller');
  const canvasWidth = () => totalBars * BASE_BAR_WIDTH * zoom;
  const pps = () => canvasWidth() / song.durationSec;

  // --- regua de compassos ---------------------------------------------------
  const ruler = el('div', 'tl-ruler');
  const meter = el('div', 'tl-meter');
  meter.textContent = `${song.beatsPerBar}/4`;
  const rulerTrack = el('div', 'tl-track');
  for (let bar = 1; bar <= totalBars; bar += 4) {
    const tick = el('div', 'tl-bar-tick');
    tick.style.left = `${(bar - 1) * BASE_BAR_WIDTH * zoom}px`;
    tick.textContent = String(bar);
    rulerTrack.appendChild(tick);
  }
  ruler.append(meter, rulerTrack);

  // --- linha de cifras ------------------------------------------------------
  const chords = el('div', 'tl-chords');
  const chordTrack = el('div', 'tl-track');
  function paintChords(): void {
    chordTrack.innerHTML = '';
    let lastX = -Infinity;
    for (const section of song.sections) {
      for (let bar = section.startBar; bar < section.endBar; bar++) {
        const chord = chordAtBar(section, bar);
        const previous = bar > section.startBar ? chordAtBar(section, bar - 1) : null;
        // So escreve quando o acorde muda — cifra repetida vira ruido visual.
        if (previous && previous.degree === chord.degree && previous.quality === chord.quality) continue;
        const x = (bar - 1) * BASE_BAR_WIDTH * zoom;
        if (x < lastX) continue;
        const label = el('div', 'tl-chord');
        label.style.left = `${x}px`;
        label.textContent = chordName(chord, key);
        chordTrack.appendChild(label);
        // Mede a largura REAL em vez de estimar por numero de caracteres:
        // "Am" e "G" tem larguras diferentes e a estimativa deixava passar
        // colisao. Aqui a cifra ou cabe, ou nao entra.
        lastX = x + label.offsetWidth + 6;
      }
    }
  }
  paintChords();
  chords.appendChild(chordTrack);

  // --- lanes ----------------------------------------------------------------
  const lanes = el('div', 'tl-lanes');

  // Click
  const clickLane = lane('Click', CLICK_COLOR, 'click');
  drawClick(clickLane.canvas, song, canvasWidth(), laneHeights().click);
  const clickFooter = el('div', 'lane-footer');
  clickFooter.innerHTML = `
    <span class="lane-select"><span class="ico">🔊</span> Cowbell <span class="chev">⌃</span></span>
    <span class="seg"><button data-sub="0.5">0.5x</button><button data-sub="1" class="on">1x</button><button data-sub="2">2x</button></span>`;
  clickLane.body.appendChild(clickFooter);

  // Guia: blocos de secao, clicaveis (e assim que se navega no Studio)
  const guideLane = lane('Guia', GUIDE_COLOR, 'guide');
  const guideBlocks = el('div', 'guide-blocks');
  for (const section of song.sections) {
    const start = timeOfBar(song.grid, section.startBar);
    const end = timeOfBar(song.grid, section.endBar);
    const block = el('button', 'guide-block');
    block.style.left = `${start * pps()}px`;
    block.style.width = `${Math.max(2, (end - start) * pps() - 3)}px`;
    block.innerHTML = `<span>${section.label.toUpperCase()}</span><span class="chev">⌄</span>`;
    block.addEventListener('click', () => onSectionClick(section.id));
    block.dataset.sectionId = section.id;
    guideBlocks.appendChild(block);
  }
  guideLane.canvas.replaceWith(guideBlocks);
  const guideFooter = el('div', 'lane-footer');
  guideFooter.innerHTML = `<span class="lane-select"><span class="ico">🌐</span> PT-BR <span class="chev">⌃</span></span>`;
  guideLane.body.appendChild(guideFooter);

  lanes.append(clickLane.root, guideLane.root);

  // Stems
  const stemCanvases = new Map<StemKey, HTMLCanvasElement>();
  for (const stem of STEMS) {
    const stemLane = lane(stem.label, stem.color, stem.key);
    const peaks = computePeaks(arrangement[stem.key], song.durationSec);
    drawWave(stemLane.canvas, peaks, canvasWidth(), laneHeights().stem);
    stemCanvases.set(stem.key, stemLane.canvas);
    lanes.appendChild(stemLane.root);
  }

  const playhead = el('div', 'tl-playhead');
  scroller.append(ruler, chords, lanes, playhead);
  container.appendChild(scroller);

  function redraw(): void {
    const width = canvasWidth();
    scroller.style.setProperty('--tl-width', `${width}px`);
    for (const tick of rulerTrack.children) {
      const bar = Number((tick as HTMLElement).textContent);
      (tick as HTMLElement).style.left = `${(bar - 1) * BASE_BAR_WIDTH * zoom}px`;
    }
    paintChords();
    drawClick(clickLane.canvas, song, width, laneHeights().click);
    for (const stem of STEMS) {
      const canvas = stemCanvases.get(stem.key)!;
      drawWave(canvas, computePeaks(arrangement[stem.key], song.durationSec), width, laneHeights().stem);
    }
    for (const block of guideBlocks.children) {
      const b = block as HTMLElement;
      const section = song.sections.find((s) => s.id === b.dataset.sectionId)!;
      const start = timeOfBar(song.grid, section.startBar);
      const end = timeOfBar(song.grid, section.endBar);
      b.style.left = `${start * pps()}px`;
      b.style.width = `${Math.max(2, (end - start) * pps() - 3)}px`;
    }
  }

  redraw();

  return {
    root: scroller,
    setZoom(z) { zoom = Math.max(0.35, Math.min(4, z)); redraw(); },
    zoom: () => zoom,
    pixelsPerSecond: pps,
    redraw,
  };
}

function lane(label: string, color: string, key: string) {
  const root = el('div', 'lane');
  root.dataset.stem = key;
  const body = el('div', 'lane-body');
  body.style.background = color;
  const head = el('div', 'lane-head');
  head.innerHTML = `<span class="lane-name">${label}</span>
    <button class="lane-ico" title="Baixar">⤓</button>
    <button class="lane-ico" title="Rotear">⤳</button>`;
  const canvas = document.createElement('canvas');
  canvas.className = 'lane-canvas';
  body.append(head, canvas);
  root.appendChild(body);
  return { root, body, canvas, head };
}

/** Click desenhado como ticks verticais, com o acento mais alto. */
function drawClick(canvas: HTMLCanvasElement, song: DemoSong, width: number, height: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  g.strokeStyle = 'rgba(255,255,255,.9)';
  const pps = width / song.durationSec;
  for (const beat of song.grid.beats) {
    const x = beat.timestamp * pps;
    if (x > width) break;
    const h = beat.downbeat ? height * 0.82 : height * 0.5;
    g.lineWidth = beat.downbeat ? 1.6 : 1;
    g.globalAlpha = beat.downbeat ? 1 : 0.65;
    g.beginPath();
    g.moveTo(x, (height - h) / 2);
    g.lineTo(x, (height + h) / 2);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Waveform espelhada, branca sobre a cor da lane. */
function drawWave(canvas: HTMLCanvasElement, peaks: number[], width: number, height: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  g.fillStyle = 'rgba(255,255,255,.92)';
  const mid = height / 2;
  const step = width / peaks.length;
  const barWidth = Math.max(1, step * 0.55);
  for (let i = 0; i < peaks.length; i++) {
    const amp = peaks[i]!;
    // Piso visivel: mesmo em silencio a lane mostra a linha de base, como no
    // editor de referencia — ajuda a ler onde o stem existe.
    const h = Math.max(1.5, amp * (height * 0.86));
    g.fillRect(i * step, mid - h / 2, barWidth, h);
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
