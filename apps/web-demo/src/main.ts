/**
 * KroniLab — Studio, Mixer e Live Mode.
 *
 * Toda decisao de tempo vem do @kronilab/core, o mesmo codigo coberto pelos
 * testes do app. Esta camada so desenha e toca.
 */
import {
  TapTempo, bpmAtTime, dueAction, nextSection, planLoopWrap, planNudge,
  planSectionJump, planTempoReconcile, positionAt, sectionAtTime, timeOfBar,
  NUDGE_STEP_MS,
} from '@kronilab/core';
import type { QuantizeMode } from '@kronilab/core';
import { buildArrangement, computePeaks, type Arrangement } from './arrangement.ts';
import { SETLIST, STEMS, type DemoSection, type DemoSong } from './data.ts';
import { DemoEngine } from './engine.ts';
import { renderMixer } from './mixer.ts';
import { renderTimeline, type TimelineHandles } from './timeline.ts';

const engine = new DemoEngine();
const tapTempo = new TapTempo();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let song: DemoSong = SETLIST[0]!;
let arrangement: Arrangement = buildArrangement(song);
let timeline: TimelineHandles | null = null;
let quantize: QuantizeMode = 'next-bar';
let queuedPlan: ReturnType<typeof planSectionJump> = null;
let loopPlan: ReturnType<typeof planLoopWrap> = null;
let loopSectionId: string | null = null;
let lastAnnounced: string | null = null;
let follow = true;

// ---------------------------------------------------------------------------
// Log — mostra a decisao do core ANTES do efeito. E o ponto da demo: da para
// ver que o salto foi enfileirado, e so entao executado.
// ---------------------------------------------------------------------------
function log(text: string, tone: 'info' | 'queued' | 'done' = 'info'): void {
  const line = document.createElement('div');
  line.className = `log-line log-${tone}`;
  line.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('pt-BR', { hour12: false })}</span> ${text}`;
  const box = $('log');
  box.prepend(line);
  while (box.childElementCount > 40) box.lastElementChild?.remove();
}

// ---------------------------------------------------------------------------
// Carregar musica
// ---------------------------------------------------------------------------
function loadSong(index: number): void {
  engine.pause();
  song = SETLIST[index]!;
  arrangement = buildArrangement(song);
  queuedPlan = null;
  loopPlan = null;
  loopSectionId = null;
  lastAnnounced = null;

  engine.load(arrangement, song.durationSec);
  timeline = renderTimeline($('timeline'), song, arrangement, requestJump);
  renderMixer($('mixer'), engine);
  renderLiveSections();
  renderSetlist(index);
  drawSummary();

  const key = song.selectedKey ?? song.originalKey;
  // Titulo sozinho: e o que o musico procura na tela, nao o nome do artista.
  $('song-title').textContent = song.title;
  $('meta-key').textContent = key;
  $('meta-bpm').textContent = String(song.bpm);
  $('meta-dur').textContent = formatTime(song.durationSec);
  $('sel-key').textContent = key;
  $('sel-bpm').textContent = String(song.bpm);
  $('sel-countin').textContent = `${song.countInBars} comp.`;
  $('tr-total').textContent = formatTime(song.durationSec);
  $('live-title').textContent = song.title.toUpperCase();
  $('live-meta').textContent = `${key} • ${song.bpm} BPM • ${song.beatsPerBar}/4`;

  log(`<b>${song.title}</b> carregada em ${key}${song.selectedKey && song.selectedKey !== song.originalKey ? ` (original ${song.originalKey})` : ''}`);
}

function renderSetlist(activeIndex: number): void {
  const strip = $('setlist');
  strip.innerHTML = '';
  SETLIST.forEach((item, i) => {
    const card = document.createElement('button');
    card.className = `sl-card${i === activeIndex ? ' is-active' : ''}`;
    card.innerHTML = `
      <span class="sl-art" style="--i:${i}"></span>
      <span class="sl-name">${i === activeIndex ? '▶ ' : ''}${item.title} (${item.selectedKey ?? item.originalKey})</span>`;
    card.addEventListener('click', () => loadSong(i));
    strip.appendChild(card);
  });
}

/** Waveform-resumo da musica inteira, com os marcadores de secao por cima. */
function drawSummary(): void {
  const canvas = $<HTMLCanvasElement>('summary');
  const width = canvas.parentElement!.clientWidth || 720;
  const height = 64;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);

  // Mixdown: a soma dos stems, que e o que o operador ve no topo.
  const mix = STEMS.map((s) => computePeaks(arrangement[s.key], song.durationSec, 40));
  const length = Math.max(...mix.map((p) => p.length));
  const step = width / length;
  g.fillStyle = 'rgba(190,200,215,.85)';
  for (let i = 0; i < length; i++) {
    const amp = Math.min(1, mix.reduce((sum, peaks) => sum + (peaks[i] ?? 0), 0) / 3);
    const h = Math.max(1.5, amp * height * 0.82);
    g.fillRect(i * step, (height - h) / 2, Math.max(1, step * 0.6), h);
  }

  const markers = $('markers');
  markers.innerHTML = '';
  for (const section of song.sections) {
    const x = (timeOfBar(song.grid, section.startBar) / song.durationSec) * width;
    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.style.left = `${x}px`;
    marker.textContent = shortLabel(section);
    marker.title = section.label;
    markers.appendChild(marker);
  }
}

/** Rotulo curto no estilo dos marcadores de palco: V1, R2, Po, Fi. */
function shortLabel(section: DemoSection): string {
  const n = section.label.match(/\d+/)?.[0] ?? '';
  const map: Record<string, string> = {
    Intro: 'I', Verse: 'V', PreChorus: 'P', Chorus: 'R',
    Bridge: 'Po', Instrumental: 'In', Solo: 'So', Break: 'B', Outro: 'Fi',
  };
  return (map[section.type] ?? '?') + n;
}

function renderLiveSections(): void {
  const list = $('live-sections');
  list.innerHTML = '';
  for (const section of song.sections) {
    const button = document.createElement('button');
    button.className = 'live-section';
    button.dataset.id = section.id;
    button.innerHTML = `
      <span class="lbl">${section.label.toUpperCase()}</span>
      <span class="live-section-meta">
        <span class="tag tag-loop">LOOP</span>
        <span class="tag tag-queued">NA FILA</span>
        <span class="bars">${section.endBar - section.startBar} comp.</span>
      </span>`;
    button.addEventListener('click', () => requestJump(section.id));
    let held: number | 0 = 0;
    button.addEventListener('pointerdown', () => {
      held = window.setTimeout(() => { toggleLoop(section.id); held = 0; }, 520);
    });
    button.addEventListener('pointerup', () => { if (held) window.clearTimeout(held); });
    button.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleLoop(section.id); });
    list.appendChild(button);
  }
}

// ---------------------------------------------------------------------------
// Acoes — a decisao e sempre do core
// ---------------------------------------------------------------------------
function requestJump(sectionId: string): void {
  const now = engine.position();
  queuedPlan = planSectionJump({
    grid: song.grid, sections: song.sections, now, targetSectionId: sectionId, mode: quantize,
  });
  if (!queuedPlan) return;
  const section = song.sections.find((s) => s.id === sectionId)!;
  log(`<b>${section.label}</b> enfileirado — troca em ${(queuedPlan.executeAt - now).toFixed(2)}s (${boundaryName(queuedPlan.boundary)})`, 'queued');
}

function toggleLoop(sectionId: string): void {
  const section = song.sections.find((s) => s.id === sectionId)!;
  if (loopSectionId === sectionId) {
    loopSectionId = null;
    loopPlan = null;
    log('Loop desligado');
    return;
  }
  loopSectionId = sectionId;
  loopPlan = planLoopWrap({ grid: song.grid, sections: song.sections, loopSectionId: sectionId, now: engine.position() });
  log(`Loop em <b>${section.label}</b>${loopPlan ? '' : ' (arma quando o playhead entrar)'}`);
}

function nudge(direction: -1 | 1): void {
  const bpm = bpmAtTime(song.grid, engine.position()) || song.bpm;
  const plan = planNudge({ offsetMs: direction * NUDGE_STEP_MS, baseBpm: bpm });
  engine.applyTempoRamp(plan.rate, plan.durationSec);
  log(`Nudge ${plan.appliedMs > 0 ? '+' : ''}${plan.appliedMs}ms — ${plan.bpmFrom} → ${plan.bpmTo} BPM por ${plan.durationSec}s`);
}

function tap(): void {
  const result = tapTempo.tap(performance.now());
  $('lv-tap').textContent = result.bpm ? `TAP ${result.bpm}` : 'TAP';
  if (!result.bpm) return;
  const vsBpm = bpmAtTime(song.grid, engine.position()) || song.bpm;
  if (result.confidence > 0.6) {
    const plan = planTempoReconcile({ vsBpm, bandBpm: result.bpm });
    engine.applyTempoRamp(plan.targetRate, plan.glideSec);
    log(`Tap: banda em ${result.bpm} BPM — VS desliza ${plan.bpmFrom} → ${plan.bpmTo} em ${plan.glideSec}s${plan.clamped ? ' (limitado)' : ''}`);
  } else {
    log(`Tap: ${result.bpm} BPM, confianca ${Math.round(result.confidence * 100)}% — baixa demais para agir`);
  }
}

function boundaryName(boundary: string): string {
  return boundary === 'bar' ? 'proximo compasso' : boundary === 'beat' ? 'proximo tempo' : 'fim da secao';
}

function quantizeName(mode: QuantizeMode): string {
  return mode === 'next-bar' ? 'COMPASSO' : mode === 'next-beat' ? 'TEMPO' : 'FIM DA SECAO';
}

// ---------------------------------------------------------------------------
// Loop de UI
// ---------------------------------------------------------------------------
function frame(): void {
  const now = engine.position();
  const current = sectionAtTime(song.grid, song.sections, now);
  const musical = positionAt(song.grid, now);

  // Entrega o plano vencido a engine, dentro da janela de agendamento.
  const action = dueAction({ queued: queuedPlan, loop: loopPlan }, now, 0.5);
  if (action) {
    engine.scheduleJump({ executeAt: action.executeAt, seekTo: action.seekTo });
    if ('targetSectionId' in action) {
      queuedPlan = null;
    } else {
      loopPlan = planLoopWrap({
        grid: song.grid, sections: song.sections,
        loopSectionId: action.sectionId, now: action.seekTo,
      });
    }
  }
  if (loopSectionId && !loopPlan) {
    loopPlan = planLoopWrap({ grid: song.grid, sections: song.sections, loopSectionId, now });
  }

  // Guia: anuncia a proxima secao um compasso antes de ela comecar.
  const upcoming = song.sections.find((s) => {
    const cue = timeOfBar(song.grid, s.startBar - 1);
    return now >= cue && now < timeOfBar(song.grid, s.startBar) && s.id !== lastAnnounced;
  });
  if (upcoming) {
    lastAnnounced = upcoming.id;
    engine.announce(upcoming.label, now);
  }

  const queuedSection = queuedPlan
    ? song.sections.find((s) => s.id === queuedPlan!.targetSectionId) ?? null
    : null;

  // --- pintura ---
  $('live-position').textContent = `${musical.bar}.${musical.beat}`;
  $('live-current').textContent = current?.label.toUpperCase() ?? '—';
  $('live-next').textContent = (queuedSection ?? nextSection(song.sections, current?.id ?? null))?.label.toUpperCase() ?? '—';
  const rate = engine.currentRate();
  $('live-rate').textContent = rate === 1 ? '' : `${rate > 1 ? '+' : ''}${Math.round((rate - 1) * 1000) / 10}%`;
  $('tr-current').textContent = formatTime(now);
  ($('tr-slider') as HTMLInputElement).value = String(Math.round((now / song.durationSec) * 1000));
  $('tr-play').textContent = engine.playing ? '❚❚' : '▶';

  for (const el of document.querySelectorAll<HTMLElement>('.live-section')) {
    const id = el.dataset.id!;
    el.classList.toggle('is-current', current?.id === id);
    el.classList.toggle('is-queued', queuedSection?.id === id);
    el.classList.toggle('is-loop', loopSectionId === id);
  }
  for (const el of document.querySelectorAll<HTMLElement>('.guide-block')) {
    const id = el.dataset.sectionId!;
    el.classList.toggle('is-current', current?.id === id);
    el.classList.toggle('is-queued', queuedSection?.id === id);
  }

  if (timeline) {
    const x = now * timeline.pixelsPerSecond();
    const head = timeline.root.querySelector<HTMLElement>('.tl-playhead');
    if (head) head.style.left = `${x}px`;
    if (follow && engine.playing) {
      const scroller = $('timeline');
      const target = x - scroller.clientWidth * 0.4;
      if (Math.abs(scroller.scrollLeft - target) > 40) scroller.scrollLeft = target;
    }
  }
  const cursor = $('summary-cursor');
  cursor.style.left = `${(now / song.durationSec) * 100}%`;

  requestAnimationFrame(frame);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
engine.onJumpExecuted = (seekTo) => {
  // "Confirmado", nao "ja aconteceu": o audio cruza o ponto ate 120ms depois.
  const section = sectionAtTime(song.grid, song.sections, seekTo);
  log(`Salto confirmado → <b>${section?.label ?? '?'}</b> (compasso ${section?.startBar ?? '?'})`, 'done');
};

$('tr-play').addEventListener('click', async () => {
  if (engine.playing) { engine.pause(); log('Pause'); }
  else { await engine.play(); log('Play'); }
});
$('tr-start').addEventListener('click', () => engine.seek(0));
$('tr-end').addEventListener('click', () => engine.seek(Math.max(0, song.durationSec - 4)));
$('tr-back').addEventListener('click', () => engine.seek(shiftBars(-1)));
$('tr-fwd').addEventListener('click', () => engine.seek(shiftBars(1)));
$('tr-follow').addEventListener('click', () => {
  follow = !follow;
  $('tr-follow').classList.toggle('on', follow);
});
$('tr-loop').addEventListener('click', () => {
  const current = sectionAtTime(song.grid, song.sections, engine.position());
  if (current) toggleLoop(current.id);
});
$('tr-slider').addEventListener('input', (e) => {
  engine.seek((Number((e.target as HTMLInputElement).value) / 1000) * song.durationSec);
});

function shiftBars(delta: number): number {
  const bar = positionAt(song.grid, engine.position()).bar;
  return timeOfBar(song.grid, Math.max(1, bar + delta));
}

$('view-toggle').addEventListener('click', () => {
  const mixerHidden = $('mixer-view').classList.contains('is-hidden');
  $('mixer-view').classList.toggle('is-hidden', !mixerHidden);
  $('studio').classList.toggle('is-hidden', mixerHidden);
  $('view-toggle').textContent = mixerHidden ? '▤' : '▥';
});
$('next-song').addEventListener('click', () => {
  const i = SETLIST.findIndex((s) => s.id === song.id);
  loadSong((i + 1) % SETLIST.length);
});

$('live-btn').addEventListener('click', () => $('live').classList.remove('is-hidden'));
$('lv-exit').addEventListener('click', () => $('live').classList.add('is-hidden'));
$('lv-nudge-down').addEventListener('click', () => nudge(-1));
$('lv-nudge-up').addEventListener('click', () => nudge(1));
$('lv-tap').addEventListener('click', tap);
$('lv-cancel').addEventListener('click', () => {
  queuedPlan = null;
  engine.cancelJump();
  log('Fila cancelada');
});
$('lv-quantize').addEventListener('click', () => {
  const order: QuantizeMode[] = ['next-bar', 'next-beat', 'end-of-section'];
  quantize = order[(order.indexOf(quantize) + 1) % order.length]!;
  $('lv-quantize').textContent = `SALTO: ${quantizeName(quantize)}`;
  log(`Modo de salto: ${quantizeName(quantize)}`);
});

$('zoom-in').addEventListener('click', () => timeline?.setZoom(timeline.zoom() * 1.4));
$('zoom-out').addEventListener('click', () => timeline?.setZoom(timeline.zoom() / 1.4));

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); $('tr-play').click(); }
  if (e.key === 't') tap();
  if (e.key === 'ArrowLeft') nudge(-1);
  if (e.key === 'ArrowRight') nudge(1);
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && song.sections[n - 1]) requestJump(song.sections[n - 1]!.id);
});

window.addEventListener('resize', () => drawSummary());

loadSong(0);
log('Toque PLAY. O audio e sintetizado no navegador — nenhuma gravacao envolvida.');
requestAnimationFrame(frame);
