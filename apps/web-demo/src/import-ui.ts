/**
 * Importar musica: do arquivo ao beat grid, em uma tela.
 *
 * O fluxo e o do produto: sobe o audio, a analise propoe BPM e primeiro
 * beat, o usuario CONFERE ouvindo (click por cima da gravacao) e ajusta se
 * preciso, marca as secoes em compassos e salva. Nada vai para o culto sem
 * o ouvido de alguem ter aprovado a grade.
 */
import { buildBeatGrid } from '@kronilab/core';
import { ClickSynth, buildClickEvents } from './click.ts';
import { SECTION_TYPES, barsInAudio, songFromStored, type DemoSong } from './data.ts';
import {
  analyzeTempo, computeBufferPeaks, decodeAudioFile, refineDownbeat, titleFromFileName,
  importStemFiles, trackBeats,
  type ImportedAudio, type TempoAnalysis, type StemImportResult
} from './importer.ts';
import { detectSections } from './structure.ts';
import type { Beat } from '@kronilab/core';
import { songStore, type StoredSection, type StoredSong } from './store.ts';

const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

interface Draft {
  id: string;
  file: File | Blob; // O mix original, ou o primeiro stem se não houver mix
  fileName: string;
  buffer: AudioBuffer;
  audio?: ImportedAudio;
  stems?: Record<string, ImportedAudio>;
  beats?: number[]; // Beats rastreados se for importação avançada
  analysis: TempoAnalysis | null;
  title: string;
  artist: string;
  key: string;
  bpm: number;
  firstDownbeatAt: number;
  sections: StoredSection[];
  createdAt: number;
}

export interface ImportDialog {
  open(existing?: DemoSong): void;
}

export function createImportDialog(
  root: HTMLElement,
  getContext: () => AudioContext,
  onSaved: (song: DemoSong) => void,
  onDeleted: (id: string) => void,
): ImportDialog {
  let draft: Draft | null = null;
  let preview: { stop(): void } | null = null;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;

  root.innerHTML = `
    <div class="im-backdrop" data-close></div>
    <div class="im-panel" role="dialog" aria-label="Importar música">
      <header class="im-head">
        <h2>Importar música</h2>
        <button class="icon-btn small" data-close title="Fechar">✕</button>
      </header>

      <section class="im-step" data-step="file">
        <label class="im-drop" id="im-drop">
          <input type="file" id="im-file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac">
          <span class="im-drop-ico">⤒</span>
          <b>Solte o áudio aqui</b>
          <span>ou toque para escolher · MP3, WAV, M4A, FLAC, OGG</span>
        </label>
        <p class="im-hint">A separação em stems é feita pelo worker de IA. Aqui a gravação inteira entra como <b>Mix</b>, com click e guia por cima — já dá para ensaiar e tocar ao vivo.</p>
      </section>

      <section class="im-step is-hidden" data-step="analyzing">
        <div class="im-spinner"></div>
        <p id="im-status">Decodificando…</p>
      </section>

      <section class="im-step is-hidden" data-step="edit">
        <div class="im-block" id="im-stems-block" style="display:none; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
          <div class="im-block-head" style="margin-bottom: 8px;"><b>Stems Identificados</b></div>
          <div id="im-stems-list" style="display:flex;gap:4px;flex-wrap:wrap;"></div>
        </div>
        <div class="im-grid">
          <label class="im-field im-span2"><span>Título</span><input id="im-title" maxlength="100"></label>
          <label class="im-field"><span>Artista</span><input id="im-artist" maxlength="60" placeholder="opcional"></label>
          <label class="im-field"><span>Tom</span><select id="im-key">${KEYS.map((k) => `<option>${k}</option>`).join('')}</select></label>
        </div>

        <div class="im-block">
          <div class="im-block-head">
            <b>Andamento</b>
            <span id="im-confidence" class="im-badge"></span>
          </div>
          <div class="im-bpm-row">
            <button class="im-stepper" id="im-bpm-down">−</button>
            <input id="im-bpm" type="number" step="0.1" min="40" max="240">
            <button class="im-stepper" id="im-bpm-up">+</button>
            <span class="im-unit">BPM</span>
            <button class="im-btn" id="im-tap">Tap</button>
            <div class="im-alts" id="im-alts"></div>
          </div>
          <div class="im-bpm-row">
            <span class="im-unit">Primeiro tempo em</span>
            <button class="im-stepper" id="im-off-down" title="−20 ms">−</button>
            <input id="im-offset" type="number" step="0.01" min="0">
            <button class="im-stepper" id="im-off-up" title="+20 ms">+</button>
            <span class="im-unit">s</span>
            <button class="im-btn" id="im-redetect" title="Recalcular o primeiro tempo para este BPM">↻</button>
            <button class="im-btn im-btn-primary" id="im-preview">▶ Ouvir com click</button>
          </div>
          <p class="im-hint">Toque em <b>Ouvir com click</b>: se o click cair fora da batida, corrija o BPM (ou escolha uma das alternativas) e o primeiro tempo. Compassos: <b id="im-bars">—</b></p>
        </div>

        <div class="im-block">
          <div class="im-block-head">
            <b>Seções</b>
            <button class="im-btn" id="im-add-section">+ Seção</button>
          </div>
          <div class="im-sections" id="im-sections"></div>
          <p class="im-hint">Em compassos. A última seção vai até o fim da música. É o que a guia fala e o que o Live Mode salta.</p>
        </div>
      </section>

      <footer class="im-foot is-hidden" data-step="edit">
        <button class="im-btn im-btn-danger is-hidden" id="im-delete">Apagar</button>
        <span class="im-spacer"></span>
        <button class="im-btn" data-close>Cancelar</button>
        <button class="im-btn im-btn-primary" id="im-save">Salvar na setlist</button>
      </footer>
    </div>`;

  const show = (step: 'file' | 'analyzing' | 'edit') => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-step]')) {
      el.classList.toggle('is-hidden', el.dataset.step !== step);
    }
  };

  const close = () => {
    stopPreview();
    root.classList.add('is-hidden');
  };
  for (const el of root.querySelectorAll('[data-close]')) el.addEventListener('click', close);

  // --- arquivo --------------------------------------------------------------
  const fileInput = $<HTMLInputElement>('#im-file');
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length > 0) void ingest(files);
    fileInput.value = '';
  });
  const drop = $('#im-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void ingest(files);
  });

  async function ingest(files: File[], existing?: StoredSong): Promise<void> {
    const file = files[0]!;
    const fileName = file.name;

    show('analyzing');
    const status = $('#im-status');
    try {
      status.textContent = 'Decodificando o áudio…';
      const ctx = getContext();
      const buffer = await decodeAudioFile(ctx, file);
      if (buffer.duration > 15 * 60) throw new Error('Áudio maior que 15 minutos.');
      status.textContent = 'Procurando a batida…';
      await nextFrame();
      let analysis = existing ? null : analyzeTempo(buffer);
      
      let audio: ImportedAudio | undefined = undefined;
      let stems: Record<string, ImportedAudio> | undefined = undefined;
      let beats: Beat[] | undefined = undefined;
      let sections = existing?.sections;
      let bpm = existing?.bpm ?? analysis!.bpm;
      let firstDownbeatAt = existing?.firstDownbeatAt ?? analysis!.firstDownbeatAt;
      
      if (files.length > 1) {
        status.textContent = 'Importando múltiplos stems...';
        const result = await importStemFiles(ctx, files);
        if (result.stems.size > 0) {
          stems = Object.fromEntries(result.stems);
          
          // Se não há "mix", escolhe o primeiro stem como buffer principal para navegação
          if (!result.stems.has('mix' as any)) {
             const firstStem = Array.from(result.stems.values())[0];
             if (firstStem) {
                // Analise avancada
                status.textContent = 'Rastreando beats (Ellis DP)...';
                beats = trackBeats(firstStem.buffer);
                if (beats.length > 0) {
                   bpm = 120; // BPM médio, mas a grade que importa é variável
                   firstDownbeatAt = beats[0].timestamp;
                   status.textContent = 'Analisando estrutura...';
                   sections = detectSections(firstStem.buffer, beats);
                }
             }
          }
        } else {
          audio = { buffer, peaks: computeBufferPeaks(buffer), fileName, bytes: file.size };
        }
      } else {
         audio = { buffer, peaks: computeBufferPeaks(buffer), fileName, bytes: file.size };
      }
      
      sections = sections ?? defaultSections(buffer.duration, bpm, firstDownbeatAt);
      
      draft = {
        id: existing?.id ?? `imp-${Date.now().toString(36)}`,
        file, fileName, buffer, audio, stems, analysis,
        beats: beats ? beats.map(b => b.timestamp) : undefined,
        title: existing?.title ?? titleFromFileName(fileName),
        artist: existing?.artist ?? '',
        key: existing?.key ?? 'C',
        bpm,
        firstDownbeatAt,
        sections,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      $('#im-delete').classList.toggle('is-hidden', !existing);
      paintEdit();
      show('edit');
    } catch (err) {
      status.textContent = `Não deu: ${(err as Error).message}`;
      window.setTimeout(() => show('file'), 2200);
    }
  }

  // --- edicao ---------------------------------------------------------------
  const titleInput = $<HTMLInputElement>('#im-title');
  const artistInput = $<HTMLInputElement>('#im-artist');
  const keySelect = $<HTMLSelectElement>('#im-key');
  const bpmInput = $<HTMLInputElement>('#im-bpm');
  const offsetInput = $<HTMLInputElement>('#im-offset');

  function paintEdit(): void {
    if (!draft) return;
    titleInput.value = draft.title;
    artistInput.value = draft.artist;
    keySelect.value = draft.key;
    bpmInput.value = String(draft.bpm);
    offsetInput.value = draft.firstDownbeatAt.toFixed(2);
    const conf = draft.analysis?.confidence ?? null;
    const badge = $('#im-confidence');
    badge.textContent = conf === null ? 'ajustado à mão' : conf > 0.5 ? 'batida clara' : conf > 0.25 ? 'confira ouvindo' : 'batida incerta — confira';
    badge.className = `im-badge ${conf === null ? '' : conf > 0.5 ? 'is-good' : conf > 0.25 ? 'is-mid' : 'is-low'}`;
    const alts = $('#im-alts');
    alts.innerHTML = '';
    for (const alt of draft.analysis?.alternatives ?? []) {
      const chip = document.createElement('button');
      chip.className = 'im-chip';
      chip.textContent = `${alt}`;
      chip.title = 'Usar este BPM';
      chip.addEventListener('click', () => { setBpm(alt, true); });
      alts.appendChild(chip);
    }
    paintBars();
    paintSections();
    
    const stemsBlock = $('#im-stems-block');
    if (draft.stems) {
      stemsBlock.style.display = 'block';
      const list = $('#im-stems-list');
      list.innerHTML = '';
      for (const k of Object.keys(draft.stems)) {
        const chip = document.createElement('span');
        chip.className = 'im-chip';
        chip.textContent = k;
        list.appendChild(chip);
      }
    } else {
      stemsBlock.style.display = 'none';
    }
  }

  function paintBars(): void {
    if (!draft) return;
    $('#im-bars').textContent = String(barsInAudio(draft.buffer.duration, draft.bpm, draft.firstDownbeatAt));
  }

  function setBpm(bpm: number, redetect = false): void {
    if (!draft) return;
    draft.bpm = Math.max(40, Math.min(240, Math.round(bpm * 10) / 10));
    bpmInput.value = String(draft.bpm);
    if (redetect) {
      draft.firstDownbeatAt = refineDownbeat(draft.buffer, draft.bpm);
      offsetInput.value = draft.firstDownbeatAt.toFixed(2);
    }
    paintBars();
    paintSections();
    
    const stemsBlock = $('#im-stems-block');
    if (draft.stems) {
      stemsBlock.style.display = 'block';
      const list = $('#im-stems-list');
      list.innerHTML = '';
      for (const k of Object.keys(draft.stems)) {
        const chip = document.createElement('span');
        chip.className = 'im-chip';
        chip.textContent = k;
        list.appendChild(chip);
      }
    } else {
      stemsBlock.style.display = 'none';
    }
  }

  titleInput.addEventListener('input', () => { if (draft) draft.title = titleInput.value; });
  artistInput.addEventListener('input', () => { if (draft) draft.artist = artistInput.value; });
  keySelect.addEventListener('change', () => { if (draft) draft.key = keySelect.value; });
  bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value)));
  $('#im-bpm-down').addEventListener('click', () => setBpm((draft?.bpm ?? 120) - 1));
  $('#im-bpm-up').addEventListener('click', () => setBpm((draft?.bpm ?? 120) + 1));
  $('#im-redetect').addEventListener('click', () => setBpm(draft?.bpm ?? 120, true));
  offsetInput.addEventListener('change', () => {
    if (!draft) return;
    draft.firstDownbeatAt = Math.max(0, Number(offsetInput.value));
    paintBars();
    paintSections();
    
    const stemsBlock = $('#im-stems-block');
    if (draft.stems) {
      stemsBlock.style.display = 'block';
      const list = $('#im-stems-list');
      list.innerHTML = '';
      for (const k of Object.keys(draft.stems)) {
        const chip = document.createElement('span');
        chip.className = 'im-chip';
        chip.textContent = k;
        list.appendChild(chip);
      }
    } else {
      stemsBlock.style.display = 'none';
    }
  });
  const nudgeOffset = (ms: number) => {
    if (!draft) return;
    draft.firstDownbeatAt = Math.max(0, draft.firstDownbeatAt + ms / 1000);
    offsetInput.value = draft.firstDownbeatAt.toFixed(2);
    paintBars();
  };
  $('#im-off-down').addEventListener('click', () => nudgeOffset(-20));
  $('#im-off-up').addEventListener('click', () => nudgeOffset(20));

  // Tap tempo dentro do import: bate junto com a gravacao e o BPM se acerta.
  const taps: number[] = [];
  $('#im-tap').addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1]! > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length >= 4) {
      const recent = taps.slice(-8);
      const intervals = recent.slice(1).map((t, i) => t - recent[i]!);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(60000 / avg);
    }
    $('#im-tap').textContent = taps.length < 4 ? `Tap ${taps.length}/4` : `Tap ${draft?.bpm ?? ''}`;
  });

  // --- preview: a gravacao com click por cima, 4 compassos ------------------
  $('#im-preview').addEventListener('click', () => {
    if (preview) { stopPreview(); return; }
    if (!draft) return;
    const ctx = getContext();
    void ctx.resume();
    const grid = buildBeatGrid({
      tempoMap: { segments: [{ startTime: 0, bpm: draft.bpm }] },
      duration: draft.buffer.duration,
      firstDownbeatAt: draft.firstDownbeatAt,
    });
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const click = new ClickSynth(ctx, gain);
    const src = ctx.createBufferSource();
    src.buffer = draft.buffer;
    src.connect(gain);
    const startCtx = ctx.currentTime + 0.1;
    const from = draft.firstDownbeatAt;
    const bars = 4;
    const end = from + bars * 4 * (60 / draft.bpm);
    src.start(startCtx, from, end - from);
    for (const ev of buildClickEvents(grid, 1, 0, bars * 4)) {
      click.play('cowbell', startCtx + (ev.t - from), ev, 1.2);
    }
    const button = $('#im-preview');
    button.textContent = '■ Parar';
    const timer = window.setTimeout(stopPreview, (end - from) * 1000 + 200);
    preview = {
      stop() {
        window.clearTimeout(timer);
        try { src.stop(); } catch { /* ja parou */ }
        gain.disconnect();
        button.textContent = '▶ Ouvir com click';
      },
    };
  });

  function stopPreview(): void {
    preview?.stop();
    preview = null;
  }

  // --- secoes ---------------------------------------------------------------
  const sectionsBox = $('#im-sections');
  function paintSections(): void {
    if (!draft) return;
    sectionsBox.innerHTML = '';
    const total = barsInAudio(draft.buffer.duration, draft.bpm, draft.firstDownbeatAt);
    let used = 0;
    draft.sections.forEach((section, i) => {
      const isLast = i === draft!.sections.length - 1;
      const start = used + 1;
      const bars = isLast ? Math.max(1, total - used) : section.bars;
      used += bars;
      const row = document.createElement('div');
      row.className = 'im-section';
      row.innerHTML = `
        <span class="im-sec-idx">${i + 1}</span>
        <select class="im-sec-type">${SECTION_TYPES.map((t) => `<option value="${t.type}"${t.type === section.type ? ' selected' : ''}>${t.label}</option>`).join('')}</select>
        <input class="im-sec-label" value="${escapeHtml(section.label)}" maxlength="24">
        <input class="im-sec-bars" type="number" min="1" max="256" value="${bars}" ${isLast ? 'disabled title="A última vai até o fim"' : ''}>
        <span class="im-sec-range">c. ${start}–${used}</span>
        <button class="im-sec-del" title="Remover">✕</button>`;
      row.querySelector<HTMLSelectElement>('.im-sec-type')!.addEventListener('change', (e) => {
        const type = (e.target as HTMLSelectElement).value as StoredSection['type'];
        section.type = type;
        // Rotulo acompanha o tipo, numerado pelas repeticoes anteriores.
        const base = SECTION_TYPES.find((t) => t.type === type)!.label;
        const n = draft!.sections.slice(0, i).filter((s) => s.type === type).length + 1;
        section.label = n > 1 ? `${base} ${n}` : base;
        paintSections();
      });
      row.querySelector<HTMLInputElement>('.im-sec-label')!.addEventListener('input', (e) => {
        section.label = (e.target as HTMLInputElement).value;
      });
      row.querySelector<HTMLInputElement>('.im-sec-bars')!.addEventListener('change', (e) => {
        section.bars = Math.max(1, Number((e.target as HTMLInputElement).value) || 1);
        paintSections();
      });
      row.querySelector('.im-sec-del')!.addEventListener('click', () => {
        if (draft!.sections.length <= 1) return;
        draft!.sections.splice(i, 1);
        paintSections();
      });
      sectionsBox.appendChild(row);
    });
    const over = used > total;
    sectionsBox.classList.toggle('is-over', over);
  }

  $('#im-add-section').addEventListener('click', () => {
    if (!draft) return;
    const last = draft.sections[draft.sections.length - 1]!;
    const total = barsInAudio(draft.buffer.duration, draft.bpm, draft.firstDownbeatAt);
    const used = draft.sections.slice(0, -1).reduce((a, s) => a + s.bars, 0);
    const remaining = Math.max(2, total - used);
    // Divide o que sobra: a antiga ultima fica com a primeira metade.
    last.bars = Math.max(1, Math.floor(remaining / 2));
    const nextType = last.type === 'Chorus' ? 'Verse' : 'Chorus';
    const base = SECTION_TYPES.find((t) => t.type === nextType)!.label;
    const n = draft.sections.filter((s) => s.type === nextType).length + 1;
    draft.sections.push({ type: nextType, label: n > 1 ? `${base} ${n}` : base, bars: 8 });
    paintSections();
  });

  // --- salvar / apagar ------------------------------------------------------
  $('#im-save').addEventListener('click', async () => {
    if (!draft) return;
    stopPreview();
    const stored: StoredSong = {
      id: draft.id, title: draft.title.trim() || 'Sem título', artist: draft.artist.trim(),
      key: draft.key, bpm: draft.bpm, firstDownbeatAt: draft.firstDownbeatAt, beatsPerBar: 4,
      sections: draft.sections.map((s) => ({ ...s })),
      fileName: draft.fileName, blob: draft.file, createdAt: draft.createdAt,
      beats: draft.beats,
    };
    if (draft.stems) {
      stored.stems = {};
      for (const [k, v] of Object.entries(draft.stems)) {
         // Não salva os blobs originais aqui pra simplificar, mas no app real salvaria
      }
    }
    await songStore.put(stored);
    onSaved(songFromStored(stored, draft.audio, draft.stems));
    close();
  });

  $('#im-delete').addEventListener('click', async () => {
    if (!draft) return;
    if (!window.confirm(`Apagar "${draft.title}" desta setlist?`)) return;
    await songStore.remove(draft.id);
    onDeleted(draft.id);
    close();
  });

  return {
    open(existing) {
      root.classList.remove('is-hidden');
      draft = null;
      taps.length = 0;
      $('#im-tap').textContent = 'Tap';
      if (existing?.audio && existing.storedId) {
        void songStore.list().then((all) => {
          const stored = all.find((s) => s.id === existing.storedId);
          if (stored) void ingest([stored.blob as File], stored);
          else show('file');
        });
      } else {
        show('file');
      }
    },
  };
}

/** Sem analise de estrutura ainda: blocos de 8 compassos que o usuario renomeia. */
function defaultSections(duration: number, bpm: number, offset: number): StoredSection[] {
  const total = barsInAudio(duration, bpm, offset);
  const out: StoredSection[] = [{ type: 'Intro', label: 'Intro', bars: 4 }];
  let used = 4;
  let verse = 0;
  let chorus = 0;
  let toggle = true;
  while (used < total - 8) {
    if (toggle) { verse++; out.push({ type: 'Verse', label: verse > 1 ? `Verso ${verse}` : 'Verso', bars: 8 }); }
    else { chorus++; out.push({ type: 'Chorus', label: chorus > 1 ? `Refrao ${chorus}` : 'Refrao', bars: 8 }); }
    toggle = !toggle;
    used += 8;
  }
  out.push({ type: 'Outro', label: 'Final', bars: Math.max(1, total - used) });
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
