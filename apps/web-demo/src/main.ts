/**
 * Demo do Live Mode.
 *
 * Tudo que decide tempo aqui vem do @kronilab/core — o mesmo codigo coberto
 * pelos 67 testes. A demo nao reimplementa nada: ela so desenha e toca.
 */
import {
  TapTempo, bpmAtTime, dueAction, nextSection, planLoopWrap, planNudge,
  planSectionJump, planTempoReconcile, positionAt, sectionAtTime, timeOfBar,
  NUDGE_STEP_MS, semitonesBetween,
} from '@kronilab/core';
import type { QuantizeMode, Section } from '@kronilab/core';
import { DemoEngine, keyToHz } from './engine.ts';
import { SETLIST, SECTION_DEGREE, type DemoSong } from './data.ts';

const engine = new DemoEngine();
const tapTempo = new TapTempo();

let songIndex = 0;
let song: DemoSong = SETLIST[0]!;
let quantize: QuantizeMode = 'next-bar';
let queuedPlan: ReturnType<typeof planSectionJump> = null;
let loopPlan: ReturnType<typeof planLoopWrap> = null;
let loopSectionId: string | null = null;
let lastAnnounced: string | null = null;

const $ = (id: string) => document.getElementById(id)!;

// ---------------------------------------------------------------------------
// Log: mostra a decisao do core, nao so o resultado. E o ponto da demo —
// da para VER que o salto foi enfileirado e so entao executado.
// ---------------------------------------------------------------------------
function log(text: string, tone: 'info' | 'queued' | 'done' = 'info'): void {
  const line = document.createElement('div');
  line.className = `log-line log-${tone}`;
  const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  line.innerHTML = `<span class="log-time">${time}</span> ${text}`;
  const box = $('log');
  box.prepend(line);
  while (box.childElementCount > 40) box.lastElementChild?.remove();
}

function loadSong(index: number): void {
  engine.pause();
  songIndex = index;
  song = SETLIST[index]!;
  queuedPlan = null;
  loopPlan = null;
  loopSectionId = null;
  lastAnnounced = null;
  engine.load(song.grid, keyToHz(activeKey()));
  engine.seek(0);
  renderSections();
  renderHeader();
  log(`Musica carregada: <b>${song.title}</b> em ${activeKey()}`);
}

function activeKey(): string {
  return song.selectedKey ?? song.originalKey;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderHeader(): void {
  $('song-title').textContent = song.title.toUpperCase();
  const transposed = song.selectedKey && song.selectedKey !== song.originalKey
    ? ` (original ${song.originalKey})` : '';
  $('song-meta').innerHTML =
    `<b>${activeKey()}</b>${transposed} &nbsp;•&nbsp; <span id="bpm">${song.bpm}</span> BPM &nbsp;•&nbsp; 4/4`;
}

function renderSections(): void {
  const list = $('sections');
  list.innerHTML = '';
  for (const section of song.sections) {
    const el = document.createElement('button');
    el.className = 'section';
    el.dataset.id = section.id;
    el.innerHTML = `
      <span class="section-label">${section.label.toUpperCase()}</span>
      <span class="section-meta">
        <span class="badge badge-loop">LOOP</span>
        <span class="badge badge-queued">NA FILA</span>
        <span class="section-bars">${section.endBar - section.startBar} comp.</span>
      </span>`;
    el.addEventListener('click', () => requestJump(section));
    // Segurar (ou botao direito) liga o loop.
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleLoop(section); });
    let held = 0;
    el.addEventListener('pointerdown', () => {
      held = window.setTimeout(() => { toggleLoop(section); held = 0; }, 550);
    });
    el.addEventListener('pointerup', () => { if (held) window.clearTimeout(held); });
    list.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Acoes — todas delegam a decisao ao core
// ---------------------------------------------------------------------------
function requestJump(section: Section): void {
  const now = engine.position();
  queuedPlan = planSectionJump({
    grid: song.grid, sections: song.sections, now,
    targetSectionId: section.id, mode: quantize,
  });
  if (!queuedPlan) return;
  const delay = (queuedPlan.executeAt - now).toFixed(2);
  log(`<b>${section.label}</b> enfileirado — troca em ${delay}s (${boundaryLabel(queuedPlan.boundary)})`, 'queued');
}

function toggleLoop(section: Section): void {
  if (loopSectionId === section.id) {
    loopSectionId = null;
    loopPlan = null;
    log(`Loop desligado`);
    return;
  }
  loopSectionId = section.id;
  loopPlan = planLoopWrap({
    grid: song.grid, sections: song.sections,
    loopSectionId: section.id, now: engine.position(),
  });
  log(`Loop em <b>${section.label}</b>${loopPlan ? '' : ' (ativa quando o playhead entrar na secao)'}`);
}

function boundaryLabel(b: string): string {
  return b === 'bar' ? 'proximo compasso' : b === 'beat' ? 'proximo tempo' : 'fim da secao';
}

function nudge(direction: -1 | 1): void {
  const bpm = bpmAtTime(song.grid, engine.position()) || song.bpm;
  const plan = planNudge({ offsetMs: direction * NUDGE_STEP_MS, baseBpm: bpm });
  engine.applyTempoRamp(plan.rate, plan.durationSec);
  log(`Nudge ${plan.appliedMs > 0 ? '+' : ''}${plan.appliedMs}ms — ${plan.bpmFrom} → ${plan.bpmTo} BPM por ${plan.durationSec}s`);
}

function tap(): void {
  const result = tapTempo.tap(performance.now());
  $('tap').textContent = result.bpm ? `TAP ${result.bpm}` : 'TAP';
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

// ---------------------------------------------------------------------------
// Loop de UI: le a posicao e entrega os planos vencidos a engine
// ---------------------------------------------------------------------------
function frame(): void {
  const now = engine.position();
  const current = sectionAtTime(song.grid, song.sections, now);
  const musical = positionAt(song.grid, now);

  // Entrega o plano a engine dentro da janela de agendamento.
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

  // Loop so arma quando o playhead entra na secao.
  if (loopSectionId && !loopPlan) {
    loopPlan = planLoopWrap({ grid: song.grid, sections: song.sections, loopSectionId, now });
  }

  // Guia: anuncia a proxima secao um compasso antes.
  const upcoming = song.sections.find((s) => {
    const cueTime = timeOfBar(song.grid, s.startBar - 1);
    return now >= cueTime && now < timeOfBar(song.grid, s.startBar) && s.id !== lastAnnounced;
  });
  if (upcoming) {
    lastAnnounced = upcoming.id;
    engine.announce(upcoming.label, now);
  }

  // --- pintura ---
  $('bar').textContent = `${musical.bar}.${musical.beat}`;
  $('current').textContent = current?.label.toUpperCase() ?? '—';
  const queuedSection = queuedPlan
    ? song.sections.find((s) => s.id === queuedPlan!.targetSectionId) ?? null
    : null;
  $('next').textContent = (queuedSection ?? nextSection(song.sections, current?.id ?? null))?.label.toUpperCase() ?? '—';
  const rate = engine.currentRate();
  $('bpm').textContent = String(Math.round((bpmAtTime(song.grid, now) || song.bpm) * rate));
  $('rate').textContent = rate === 1 ? '' : `${rate > 1 ? '+' : ''}${Math.round((rate - 1) * 1000) / 10}%`;

  for (const el of document.querySelectorAll<HTMLElement>('.section')) {
    const id = el.dataset.id!;
    el.classList.toggle('is-current', current?.id === id);
    el.classList.toggle('is-queued', queuedSection?.id === id);
    el.classList.toggle('is-loop', loopSectionId === id);
    // Nota de baixo da secao atual: o salto tem que ser ouvido.
    if (current?.id === id) {
      engine.setPadRoot(keyToHz(activeKey(), SECTION_DEGREE[current.type]));
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Ligacao dos controles
// ---------------------------------------------------------------------------
engine.onJumpExecuted = (seekTo) => {
  // Confirmado, nao "ja aconteceu": o audio cruza o ponto ate 120ms depois.
  const section = sectionAtTime(song.grid, song.sections, seekTo);
  log(`Salto confirmado → <b>${section?.label ?? '?'}</b> (compasso ${section?.startBar ?? '?'})`, 'done');
};

$('play').addEventListener('click', async () => {
  if (engine.playing) {
    engine.pause();
    $('play').textContent = 'PLAY';
    log('Pause');
  } else {
    await engine.play();
    $('play').textContent = 'PAUSE';
    log('Play');
  }
});
$('nudge-down').addEventListener('click', () => nudge(-1));
$('nudge-up').addEventListener('click', () => nudge(1));
$('tap').addEventListener('click', tap);
$('cancel').addEventListener('click', () => {
  queuedPlan = null;
  engine.cancelJump();
  log('Fila cancelada');
});
$('quantize').addEventListener('click', () => {
  const order: QuantizeMode[] = ['next-bar', 'next-beat', 'end-of-section'];
  quantize = order[(order.indexOf(quantize) + 1) % order.length]!;
  $('quantize').textContent = `SALTO: ${boundaryLabelMode(quantize)}`;
  log(`Modo de salto: ${boundaryLabelMode(quantize)}`);
});
$('next-song').addEventListener('click', () => loadSong((songIndex + 1) % SETLIST.length));

for (const [id, key] of [['click', 'clickOn'], ['pad', 'padOn'], ['guide', 'guideOn']] as const) {
  $(`toggle-${id}`).addEventListener('click', () => {
    (engine as any)[key] = !(engine as any)[key];
    $(`toggle-${id}`).classList.toggle('is-off', !(engine as any)[key]);
  });
}

function boundaryLabelMode(mode: QuantizeMode): string {
  return mode === 'next-bar' ? 'COMPASSO' : mode === 'next-beat' ? 'TEMPO' : 'FIM DA SECAO';
}

// Atalhos de teclado — quem opera no notebook nao quer mouse.
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if (e.key === 't') tap();
  if (e.key === 'ArrowLeft') nudge(-1);
  if (e.key === 'ArrowRight') nudge(1);
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && song.sections[n - 1]) requestJump(song.sections[n - 1]!);
});

loadSong(0);
log('Toque PLAY. O audio e sintetizado no navegador — nenhuma gravacao envolvida.');
requestAnimationFrame(frame);
