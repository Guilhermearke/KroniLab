/**
 * KroniLab — Studio, Mixer e Live Mode.
 *
 * Toda decisao de tempo vem do @kronilab/core, o mesmo codigo coberto pelos
 * testes do app. Esta camada so desenha e toca.
 *
 * Duas telas, dois momentos (ver docs/REFERENCIAS.md):
 *   - Studio: preparar a musica — lanes, click, guia, secoes, importar.
 *   - Live:   tocar o culto — transporte | setlist + secoes | faders.
 */
import {
  TapTempo, bpmAtTime, dueAction, nextSection, planLoopWrap, planNudge,
  planSectionJump, planTempoReconcile, planTransition, positionAt, sectionAtTime,
  timeOfBar, transposeKey, NUDGE_STEP_MS, TRANSITION_LABEL,
} from '@kronilab/core';
import type { QuantizeMode } from '@kronilab/core';
import { buildArrangement, computePeaks, type Arrangement } from './arrangement.ts';
import type { ClickSound, Subdivision } from './click.ts';
import {
  SETLIST, addToSetlist, removeFromSetlist, songFromStored, stemsFor,
  type DemoSection, type DemoSong,
} from './data.ts';
import { DemoEngine } from './engine.ts';
import { createImportDialog } from './import-ui.ts';
import { computeBufferPeaks, decodeAudioFile } from './importer.ts';
import { renderLiveFaders, renderMixer, renderStrips } from './mixer.ts';
import { songStore } from './store.ts';
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
let follow = true;
let transitionPlan: ReturnType<typeof planTransition> | null = null;
let advancing = false;
/** Semitons acima do tom original, por musica (o "Tom" do chip). */
const keyOffsets = new Map<string, number>();
/** BPM escolhido no chip, por musica. */
const bpmOverrides = new Map<string, number>();

// ---------------------------------------------------------------------------
// Preferencias do operador — click, guia, pre-contagem. Ficam no aparelho.
// ---------------------------------------------------------------------------
interface Prefs {
  clickSound: ClickSound;
  subdivision: Subdivision;
  countInBars: number;
  countInEnabled: boolean;
  guideVoice: string | null;
  guideLead: 'bar' | 'two-beats';
}
const prefs: Prefs = loadPrefs();

function loadPrefs(): Prefs {
  const base: Prefs = { clickSound: 'cowbell', subdivision: 1, countInBars: 2, countInEnabled: true, guideVoice: null, guideLead: 'bar' };
  try {
    const raw = localStorage.getItem('kronilab:prefs');
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch { return base; }
}
function savePrefs(): void {
  try { localStorage.setItem('kronilab:prefs', JSON.stringify(prefs)); } catch { /* modo privado */ }
}
function applyPrefs(): void {
  engine.click.sound = prefs.clickSound;
  engine.click.subdivision = prefs.subdivision;
  engine.click.countInBars = prefs.countInBars;
  engine.click.countInEnabled = prefs.countInEnabled;
  const guide = engine.guideController();
  guide.settings.voiceName = prefs.guideVoice;
  guide.settings.lead = prefs.guideLead;
}

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
function currentKey(s: DemoSong = song): string {
  const offset = keyOffsets.get(s.id) ?? 0;
  return transposeKey(s.selectedKey ?? s.originalKey, offset);
}

function currentBpm(): number {
  return bpmOverrides.get(song.id) ?? song.bpm;
}

function loadSong(index: number): void {
  engine.pause();
  song = SETLIST[index]!;
  // A transposicao do chip entra no arranjo: a VS sintetizada e as cifras
  // acompanham. Para gravacao importada o audio nao muda de tom aqui (isso e
  // processamento no aparelho, no app) — a cifra e o pad acompanham.
  const key = currentKey();
  arrangement = buildArrangement({ ...song, selectedKey: key });
  queuedPlan = null;
  loopPlan = null;
  loopSectionId = null;

  engine.load(song, arrangement);
  engine.setBaseRate(currentBpm() / song.bpm);
  const guide = engine.guideController();
  timeline = renderTimeline($('timeline'), { ...song, selectedKey: key }, arrangement, {
    onSectionClick: requestJump,
    clickSound: prefs.clickSound,
    subdivision: prefs.subdivision,
    onClickSound(sound) { prefs.clickSound = sound; savePrefs(); applyPrefs(); log(`Click: ${sound}`); },
    onSubdivision(sub) { prefs.subdivision = sub; savePrefs(); applyPrefs(); log(`Click em ${sub}x`); },
    guideVoices: guide.availableVoices().map((v) => ({ name: v.name, label: v.name.replace(/\(.*\)/, '').trim() })),
    guideVoice: prefs.guideVoice ?? guide.availableVoices()[0]?.name ?? null,
    onGuideVoice(name) { prefs.guideVoice = name || null; savePrefs(); applyPrefs(); log(`Guia: ${name || 'bipe'}`); },
  });
  renderStrips($('strips'), engine, song);
  renderMixer($('mixer'), engine, song);
  renderLiveFaders($('live-faders'), engine, song);
  renderLiveSections();
  renderSetlist(index);
  renderLiveSetlist(index);
  drawSummary();
  drawLiveWave();

  const next = SETLIST[(index + 1) % SETLIST.length]!;

  // A transicao e calculada no core; aqui so a executamos.
  transitionPlan = planTransition({
    mode: song.transition,
    duration: song.durationSec,
    padEnabled: song.padEnabled,
    currentKey: key,
    nextKey: currentKey(next),
  });
  advancing = false;

  // O pad acompanha o tom do culto: se o tom mudou, ele troca com
  // sobreposicao em vez de cortar.
  if (engine.padEnabled()) engine.setPadKey(key);

  paintSongMeta();
  log(`<b>${song.title}</b> carregada em ${key}${key !== song.originalKey ? ` (original ${song.originalKey})` : ''}${song.audio ? ' — gravação importada' : ''}`);
}

function paintSongMeta(): void {
  const key = currentKey();
  const bpm = currentBpm();
  const offset = keyOffsets.get(song.id) ?? 0;
  // Titulo sozinho: e o que o musico procura na tela, nao o nome do artista.
  $('song-title').textContent = song.title;
  $('meta-key').textContent = key;
  $('meta-bpm').textContent = String(Math.round(bpm));
  $('meta-dur').textContent = formatTime(song.durationSec);
  $('sel-key').textContent = key;
  $('sel-bpm').textContent = String(Math.round(bpm));
  $('sel-countin').textContent = prefs.countInEnabled ? `${prefs.countInBars} compasso${prefs.countInBars > 1 ? 's' : ''}` : 'desligada';
  $('chip-countin').classList.toggle('on', prefs.countInEnabled);
  $('chip-key').classList.toggle('on', offset !== 0);
  $('chip-bpm').classList.toggle('on', Math.round(bpm) !== Math.round(song.bpm));
  $('pop-key-value').textContent = `${offset > 0 ? '+' : ''}${offset}`;
  $('pop-key-note').textContent = song.audio
    ? 'Gravação importada: a cifra e o pad já mudam; o áudio é transposto no app (no aparelho).'
    : `${song.originalKey} → ${key}`;
  $('pop-bpm-value').textContent = String(Math.round(bpm));
  $('pop-countin-value').textContent = `${prefs.countInBars} compasso${prefs.countInBars > 1 ? 's' : ''}`;
  ($('countin-on') as HTMLInputElement).checked = prefs.countInEnabled;
  $('tr-total').textContent = formatTime(song.durationSec);
  $('live-total').textContent = formatTime(song.durationSec);
  $('live-title').textContent = song.title;
  $('live-sig').textContent = `${Math.round(bpm)} · ${song.beatsPerBar}/4`;
  $('lv-pad').classList.toggle('on', engine.padEnabled());
  $('pad-btn').classList.toggle('on', engine.padEnabled());
}

function renderSetlist(activeIndex: number): void {
  const strip = $('setlist');
  strip.innerHTML = '';
  SETLIST.forEach((item, i) => {
    const card = document.createElement('button');
    card.className = `sl-card${i === activeIndex ? ' is-active' : ''}${item.audio ? ' is-imported' : ''}`;
    card.innerHTML = `
      <span class="sl-art" style="--i:${i}">${item.audio ? '♫' : ''}</span>
      <span class="sl-name">${i === activeIndex ? '▶ ' : ''}${escapeHtml(item.title)} (${currentKey(item)})</span>
      ${item.audio ? '<span class="sl-edit" title="Editar">✎</span>' : ''}`;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('sl-edit')) { importDialog.open(item); return; }
      loadSong(i);
    });
    strip.appendChild(card);
  });
  const add = document.createElement('button');
  add.className = 'sl-card sl-add';
  add.innerHTML = '<span class="sl-art">+</span><span class="sl-name">Importar música</span>';
  add.addEventListener('click', () => importDialog.open());
  strip.appendChild(add);
}

/** Setlist do palco: cartoes com capa e tom, e o icone de transicao entre eles. */
function renderLiveSetlist(activeIndex: number): void {
  const strip = $('live-setlist');
  strip.innerHTML = '';
  SETLIST.forEach((item, i) => {
    if (i > 0) {
      const prev = SETLIST[i - 1]!;
      const link = document.createElement('span');
      link.className = `ls-link ls-${prev.transition}`;
      link.title = `Transição: ${TRANSITION_LABEL[prev.transition]}`;
      link.textContent = prev.transition === 'crossfade' ? '⤮' : prev.transition === 'pad' ? '≈' : prev.transition === 'stop' ? '⏹' : '→';
      strip.appendChild(link);
    }
    const card = document.createElement('button');
    card.className = `ls-card${i === activeIndex ? ' is-active' : ''}`;
    card.innerHTML = `<span class="ls-art" style="--i:${i}"></span><span class="ls-name">${escapeHtml(item.title)}</span><span class="ls-key">${currentKey(item)}</span>`;
    card.addEventListener('click', () => { loadSong(i); });
    strip.appendChild(card);
  });
  strip.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
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

  // Mixdown: a soma dos stems (ou a gravacao), que e o que o operador ve no topo.
  const mix = song.audio
    ? [song.audio.peaks]
    : stemsFor(song).map((s) => computePeaks(arrangement[s.key], song.durationSec, 40));
  const length = Math.max(...mix.map((p) => p.length));
  const step = width / length;
  g.fillStyle = 'rgba(190,200,215,.85)';
  const norm = song.audio ? 1 : 3;
  for (let i = 0; i < length; i++) {
    const amp = Math.min(1, mix.reduce((sum, peaks) => sum + (peaks[i] ?? 0), 0) / norm);
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

/** Forma de onda do palco: a musica inteira, com os blocos de secao por cima. */
function drawLiveWave(): void {
  const canvas = $<HTMLCanvasElement>('live-canvas');
  const box = canvas.parentElement!;
  const width = box.clientWidth || 800;
  const height = box.clientHeight || 120;
  if (width < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  const peaks = song.audio
    ? song.audio.peaks
    : (() => {
      const mix = stemsFor(song).map((s) => computePeaks(arrangement[s.key], song.durationSec, 40));
      const length = Math.max(...mix.map((p) => p.length));
      return Array.from({ length }, (_, i) => Math.min(1, mix.reduce((sum, p) => sum + (p[i] ?? 0), 0) / 3));
    })();
  const step = width / peaks.length;
  const mid = height / 2;
  g.fillStyle = 'rgba(200,208,222,.55)';
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i]! * height * 0.9);
    g.fillRect(i * step, mid - h / 2, Math.max(1, step * 0.7), h);
  }

  const blocks = $('live-wave-sections');
  blocks.innerHTML = '';
  for (const section of song.sections) {
    const start = timeOfBar(song.grid, section.startBar) / song.durationSec;
    const end = Math.min(1, timeOfBar(song.grid, section.endBar) / song.durationSec);
    const block = document.createElement('button');
    block.className = 'lw-block';
    block.dataset.id = section.id;
    block.style.left = `${start * 100}%`;
    block.style.width = `${Math.max(0.5, (end - start) * 100)}%`;
    block.innerHTML = `<span>${shortLabel(section)}</span>`;
    block.title = section.label;
    block.addEventListener('click', () => requestJump(section.id));
    blocks.appendChild(block);
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
      <span class="lbl">${escapeHtml(section.label.toUpperCase())}</span>
      <span class="live-section-meta">
        <span class="tag tag-loop">LOOP</span>
        <span class="tag tag-queued">NA FILA</span>
        <span class="bars">${section.endBar - section.startBar} comp.</span>
      </span>
      <span class="live-section-progress"></span>`;
    button.addEventListener('click', () => requestJump(section.id));
    let held: number | 0 = 0;
    button.addEventListener('pointerdown', () => {
      held = window.setTimeout(() => { toggleLoop(section.id); held = 0; }, 520);
    });
    button.addEventListener('pointerup', () => { if (held) window.clearTimeout(held); });
    button.addEventListener('pointerleave', () => { if (held) window.clearTimeout(held); });
    button.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleLoop(section.id); });
    list.appendChild(button);
  }
}

// ---------------------------------------------------------------------------
// Acoes — a decisao e sempre do core
// ---------------------------------------------------------------------------
function requestJump(sectionId: string): void {
  const now = engine.position();
  if (!engine.playing) {
    // Parado: e so posicionar. A fila existe para nao cortar o audio no meio.
    const section = song.sections.find((s) => s.id === sectionId)!;
    engine.seek(timeOfBar(song.grid, section.startBar));
    log(`Posicionado em <b>${section.label}</b>`);
    return;
  }
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
    log(`Tap: ${result.bpm} BPM, confiança ${Math.round(result.confidence * 100)}% — baixa demais para agir`);
  }
}

function boundaryName(boundary: string): string {
  return boundary === 'bar' ? 'próximo compasso' : boundary === 'beat' ? 'próximo tempo' : 'fim da seção';
}

function quantizeName(mode: QuantizeMode): string {
  return mode === 'next-bar' ? 'COMPASSO' : mode === 'next-beat' ? 'TEMPO' : 'FIM DA SEÇÃO';
}

async function togglePlay(): Promise<void> {
  if (engine.playing) { engine.pause(); log('Pause'); return; }
  const countIn = prefs.countInEnabled && prefs.countInBars > 0;
  await engine.play({ countIn });
  log(countIn ? `Play — pré-contagem de ${prefs.countInBars} compasso${prefs.countInBars > 1 ? 's' : ''}` : 'Play');
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

  // Transicao para a proxima musica, no momento que o plano definiu.
  if (transitionPlan?.startNextAt !== null && transitionPlan !== null
      && engine.playing && !advancing && now >= transitionPlan.startNextAt) {
    advancing = true;
    const index = SETLIST.findIndex((s) => s.id === song.id);
    const nextIndex = (index + 1) % SETLIST.length;
    log(`Transição (${TRANSITION_LABEL[transitionPlan.mode]}) → <b>${SETLIST[nextIndex]!.title}</b>`, 'done');
    loadSong(nextIndex);
    void engine.play({ countIn: false });
  }

  const queuedSection = queuedPlan
    ? song.sections.find((s) => s.id === queuedPlan!.targetSectionId) ?? null
    : null;

  // --- pintura ---
  const countingIn = now < 0;
  $('live-position').textContent = countingIn
    ? `${Math.ceil(-now / (60 / (bpmAtTime(song.grid, 0) || song.bpm)))}`
    : `${musical.bar}.${musical.beat}`;
  $('live-position').classList.toggle('is-countin', countingIn);
  $('live-current').textContent = countingIn ? 'CONTAGEM' : current?.label.toUpperCase() ?? '—';
  $('live-next').textContent = (queuedSection ?? (countingIn ? song.sections[0] : nextSection(song.sections, current?.id ?? null)))?.label.toUpperCase() ?? '—';
  const rate = engine.currentRate();
  $('live-rate').textContent = rate === 1 ? '' : `${rate > 1 ? '+' : ''}${Math.round((rate - 1) * 1000) / 10}%`;
  $('tr-current').textContent = formatTime(Math.max(0, now));
  $('live-time').textContent = formatTime(Math.max(0, now));
  ($('tr-slider') as HTMLInputElement).value = String(Math.round((Math.max(0, now) / song.durationSec) * 1000));
  $('tr-play').textContent = engine.playing ? '❚❚' : '▶';
  $('lv-play').textContent = engine.playing ? '❚❚' : '▶';

  for (const el of document.querySelectorAll<HTMLElement>('.live-section')) {
    const id = el.dataset.id!;
    const isCurrent = current?.id === id;
    el.classList.toggle('is-current', isCurrent);
    el.classList.toggle('is-queued', queuedSection?.id === id);
    el.classList.toggle('is-loop', loopSectionId === id);
    if (isCurrent && current) {
      const start = timeOfBar(song.grid, current.startBar);
      const end = timeOfBar(song.grid, current.endBar);
      el.style.setProperty('--progress', `${Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))}%`);
    } else {
      el.style.removeProperty('--progress');
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('.lw-block')) {
    const id = el.dataset.id!;
    el.classList.toggle('is-current', current?.id === id);
    el.classList.toggle('is-queued', queuedSection?.id === id);
    el.classList.toggle('is-loop', loopSectionId === id);
  }
  $('live-cursor').style.left = `${(Math.max(0, now) / song.durationSec) * 100}%`;
  for (const el of document.querySelectorAll<HTMLElement>('.guide-block')) {
    const id = el.dataset.sectionId!;
    el.classList.toggle('is-current', current?.id === id);
    el.classList.toggle('is-queued', queuedSection?.id === id);
  }

  if (timeline) {
    const x = Math.max(0, now) * timeline.pixelsPerSecond();
    const head = timeline.root.querySelector<HTMLElement>('.tl-playhead');
    if (head) head.style.left = `${x}px`;
    if (follow && engine.playing) {
      const scroller = $('timeline');
      const target = x - scroller.clientWidth * 0.4;
      if (Math.abs(scroller.scrollLeft - target) > 40) scroller.scrollLeft = target;
    }
  }
  const cursor = $('summary-cursor');
  cursor.style.left = `${(Math.max(0, now) / song.durationSec) * 100}%`;

  requestAnimationFrame(frame);
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
engine.onJumpExecuted = (seekTo) => {
  // "Confirmado", nao "ja aconteceu": o audio cruza o ponto ate 120ms depois.
  const section = sectionAtTime(song.grid, song.sections, seekTo);
  log(`Salto confirmado → <b>${section?.label ?? '?'}</b> (compasso ${section?.startBar ?? '?'})`, 'done');
};
engine.onEnded = () => {
  log(`Fim de <b>${song.title}</b>`);
  if (advancing) return;
  const index = SETLIST.findIndex((s) => s.id === song.id);
  const next = SETLIST[(index + 1) % SETLIST.length]!;
  if (song.transition === 'pad') {
    // O pad segura o tom da PROXIMA musica; ela entra quando o operador mandar.
    engine.setPadKey(currentKey(next));
    loadSong((index + 1) % SETLIST.length);
    log(`Pad segurando <b>${currentKey(next)}</b> — toque PLAY para entrar em <b>${next.title}</b>`, 'queued');
  }
  // 'stop': fica parado na mesma musica. 'auto'/'crossfade' ja avancaram no frame().
};

$('tr-play').addEventListener('click', () => void togglePlay());
$('lv-play').addEventListener('click', () => void togglePlay());
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
  $('tr-loop').classList.toggle('on', loopSectionId !== null);
});
$('tr-slider').addEventListener('input', (e) => {
  engine.seek((Number((e.target as HTMLInputElement).value) / 1000) * song.durationSec);
});

function shiftBars(delta: number): number {
  const bar = positionAt(song.grid, engine.position()).bar;
  return timeOfBar(song.grid, Math.max(1, bar + delta));
}

// Modo da mesa: preferencia do operador, nao consequencia do tamanho da tela.
function setMixerMode(mode: 'rows' | 'faders'): void {
  $('mixer').classList.toggle('is-faders', mode === 'faders');
  $('mode-rows').classList.toggle('on', mode === 'rows');
  $('mode-faders').classList.toggle('on', mode === 'faders');
  try { localStorage.setItem('kronilab:mixer-mode', mode); } catch { /* modo privado */ }
}
$('mode-rows').addEventListener('click', () => setMixerMode('rows'));
$('mode-faders').addEventListener('click', () => setMixerMode('faders'));

$('view-toggle').addEventListener('click', () => {
  const mixerHidden = $('mixer-view').classList.contains('is-hidden');
  $('mixer-view').classList.toggle('is-hidden', !mixerHidden);
  $('studio').classList.toggle('is-hidden', mixerHidden);
  $('view-toggle').textContent = mixerHidden ? '▤' : '▥';
});
const nextSong = () => loadSong((SETLIST.findIndex((s) => s.id === song.id) + 1) % SETLIST.length);
$('next-song').addEventListener('click', nextSong);
$('lv-next-song').addEventListener('click', nextSong);

function togglePad(): void {
  if (engine.padEnabled()) {
    engine.stopPad();
    log('Pad desligado (fade out)');
  } else {
    engine.setPadKey(currentKey());
    log(`Pad ligado em <b>${currentKey()}</b> (fade in)`);
  }
  $('pad-btn').classList.toggle('on', engine.padEnabled());
  $('lv-pad').classList.toggle('on', engine.padEnabled());
}
$('pad-btn').addEventListener('click', togglePad);
$('lv-pad').addEventListener('click', togglePad);

$('live-btn').addEventListener('click', () => {
  $('live').classList.remove('is-hidden');
  renderLiveSetlist(SETLIST.findIndex((s) => s.id === song.id));
  drawLiveWave(); // o canvas so tem largura depois que a tela aparece
  // Tela de palco: nada de dormir no meio do culto.
  void (navigator as { wakeLock?: { request(type: 'screen'): Promise<unknown> } }).wakeLock?.request('screen').catch(() => undefined);
});
$('lv-exit').addEventListener('click', () => $('live').classList.add('is-hidden'));
$('lv-nudge-down').addEventListener('click', () => nudge(-1));
$('lv-nudge-up').addEventListener('click', () => nudge(1));
$('lv-tap').addEventListener('click', tap);
$('lv-log-toggle').addEventListener('click', () => {
  $('log').classList.toggle('is-hidden');
  $('lv-log-toggle').classList.toggle('on', !$('log').classList.contains('is-hidden'));
});
$('lv-cancel').addEventListener('click', () => {
  queuedPlan = null;
  engine.cancelJump();
  log('Fila cancelada');
});
$('lv-quantize').addEventListener('click', () => {
  const order: QuantizeMode[] = ['next-bar', 'next-beat', 'end-of-section'];
  quantize = order[(order.indexOf(quantize) + 1) % order.length]!;
  $('lv-quantize').textContent = quantizeName(quantize);
  log(`Modo de salto: ${quantizeName(quantize)}`);
});

$('zoom-in').addEventListener('click', () => timeline?.setZoom(timeline.zoom() * 1.4));
$('zoom-out').addEventListener('click', () => timeline?.setZoom(timeline.zoom() / 1.4));

// --- chips: tom / bpm / pre-contagem ----------------------------------------
let openPop: HTMLElement | null = null;
function togglePop(id: string, anchor: HTMLElement): void {
  const pop = $(id);
  const willOpen = pop.classList.contains('is-hidden');
  for (const p of document.querySelectorAll<HTMLElement>('.pop')) p.classList.add('is-hidden');
  openPop = null;
  if (!willOpen) return;
  pop.classList.remove('is-hidden');
  openPop = pop;
  // Ancora acima do chip, alinhado a direita como no editor de referencia.
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`;
  pop.style.top = `${r.top - pop.offsetHeight - 8}px`;
}
document.addEventListener('pointerdown', (e) => {
  if (!openPop) return;
  const t = e.target as HTMLElement;
  if (openPop.contains(t) || t.closest('.chip')) return;
  openPop.classList.add('is-hidden');
  openPop = null;
});
$('chip-key').addEventListener('click', () => togglePop('pop-key', $('chip-key')));
$('chip-bpm').addEventListener('click', () => togglePop('pop-bpm', $('chip-bpm')));
$('chip-countin').addEventListener('click', () => togglePop('pop-countin', $('chip-countin')));

function shiftKey(delta: number): void {
  const offset = Math.max(-6, Math.min(6, (keyOffsets.get(song.id) ?? 0) + delta));
  keyOffsets.set(song.id, offset);
  const wasPlaying = engine.playing;
  const pos = engine.position();
  const index = SETLIST.findIndex((s) => s.id === song.id);
  loadSong(index);
  engine.seek(Math.max(0, pos));
  if (wasPlaying) void engine.play({ countIn: false });
  log(`Tom: <b>${currentKey()}</b> (${offset > 0 ? '+' : ''}${offset} st)`);
}
$('key-down').addEventListener('click', () => shiftKey(-1));
$('key-up').addEventListener('click', () => shiftKey(1));

function setBpm(bpm: number): void {
  const clamped = Math.max(Math.round(song.bpm * 0.8), Math.min(Math.round(song.bpm * 1.25), Math.round(bpm)));
  bpmOverrides.set(song.id, clamped);
  engine.setBaseRate(clamped / song.bpm);
  paintSongMeta();
  log(`Andamento: <b>${clamped} BPM</b> (${clamped === song.bpm ? 'original' : `${Math.round((clamped / song.bpm - 1) * 100)}%`})`);
}
$('bpm-down').addEventListener('click', () => setBpm(currentBpm() - 1));
$('bpm-up').addEventListener('click', () => setBpm(currentBpm() + 1));
$('bpm-reset').addEventListener('click', () => setBpm(song.bpm));
const chipTaps: number[] = [];
$('bpm-tap').addEventListener('click', () => {
  const now = performance.now();
  if (chipTaps.length && now - chipTaps[chipTaps.length - 1]! > 2000) chipTaps.length = 0;
  chipTaps.push(now);
  if (chipTaps.length >= 4) {
    const recent = chipTaps.slice(-8);
    const avg = recent.slice(1).reduce((a, t, i) => a + (t - recent[i]!), 0) / (recent.length - 1);
    setBpm(60000 / avg);
  }
  $('bpm-tap').textContent = chipTaps.length < 4 ? `👆 Tap ${chipTaps.length}/4` : '👆 Tap';
});

function setCountIn(bars: number, enabled = prefs.countInEnabled): void {
  prefs.countInBars = Math.max(1, Math.min(4, bars));
  prefs.countInEnabled = enabled;
  savePrefs();
  applyPrefs();
  paintSongMeta();
}
$('countin-down').addEventListener('click', () => setCountIn(prefs.countInBars - 1));
$('countin-up').addEventListener('click', () => setCountIn(prefs.countInBars + 1));
$('countin-on').addEventListener('change', (e) => setCountIn(prefs.countInBars, (e.target as HTMLInputElement).checked));

// --- importar ---------------------------------------------------------------
const importDialog = createImportDialog(
  $('import-dialog'),
  () => { engine.init(); return engine.audioContext()!; },
  (imported) => {
    const index = addToSetlist(imported);
    loadSong(index);
    log(`<b>${imported.title}</b> importada — ${imported.bpm} BPM, ${imported.sections.length} seções`, 'done');
  },
  (id) => {
    removeFromSetlist(id);
    loadSong(0);
    log('Música apagada');
  },
);

/** Musicas importadas em visitas anteriores voltam para a setlist. */
async function restoreImported(): Promise<void> {
  const stored = await songStore.list();
  if (!stored.length) return;
  engine.init();
  const ctx = engine.audioContext()!;
  for (const item of stored) {
    try {
      const buffer = await decodeAudioFile(ctx, item.blob);
      addToSetlist(songFromStored(item, {
        buffer, peaks: computeBufferPeaks(buffer), fileName: item.fileName, bytes: item.blob.size,
      }));
    } catch (err) {
      log(`Não consegui recarregar <b>${escapeHtml(item.title)}</b>: ${(err as Error).message}`);
    }
  }
  renderSetlist(SETLIST.findIndex((s) => s.id === song.id));
  log(`${stored.length} música${stored.length > 1 ? 's' : ''} importada${stored.length > 1 ? 's' : ''} restaurada${stored.length > 1 ? 's' : ''}`);
}

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); void togglePlay(); }
  if (e.key === 't') tap();
  if (e.key === 'ArrowLeft') nudge(-1);
  if (e.key === 'ArrowRight') nudge(1);
  if (e.key === 'Escape') { $('live').classList.add('is-hidden'); $('import-dialog').classList.add('is-hidden'); }
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && song.sections[n - 1]) requestJump(song.sections[n - 1]!.id);
});

window.addEventListener('resize', () => { drawSummary(); drawLiveWave(); });
// A waveform-resumo e a barra de busca: tocar nela posiciona.
$('summary').parentElement!.addEventListener('pointerdown', (e) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  engine.seek(frac * song.durationSec);
});

// Boot: preferencias, a primeira musica, e as importadas em seguida.
engine.init();
applyPrefs();
loadSong(0);
// Restaura a escolha anterior; na primeira visita, canais deitados.
let savedMode: string | null = null;
try { savedMode = localStorage.getItem('kronilab:mixer-mode'); } catch { /* modo privado */ }
setMixerMode(savedMode === 'faders' ? 'faders' : 'rows');
$('lv-quantize').textContent = quantizeName(quantize);
log('Toque PLAY. Importe uma gravação pela setlist para tocar com click e guia por cima.');
requestAnimationFrame(frame);
void restoreImported();
// As vozes chegam depois no Chrome: quando chegarem, a lista da guia atualiza
// no lugar — sem recarregar a musica, que pode estar tocando.
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => {
    const select = document.querySelector<HTMLSelectElement>('[data-role="guide-voice"]');
    const voices = engine.guideController().availableVoices();
    if (!select || !voices.length) return;
    select.innerHTML = voices.map((v) => `<option value="${v.name}">${v.name.replace(/\(.*\)/, '').trim()}</option>`).join('');
    select.value = prefs.guideVoice && voices.some((v) => v.name === prefs.guideVoice) ? prefs.guideVoice : voices[0]!.name;
  });
}
