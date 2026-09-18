/**
 * Mixer: um canal por stem, com M/S, volume e pan.
 *
 * O solo e resolvido na engine (uma fonte de verdade), nao aqui. A tela so
 * reflete o estado — se o mixer calculasse ganho por conta propria, mixer e
 * audio divergiriam no primeiro solo.
 */
import { CLICK_COLOR, GUIDE_COLOR, stemsFor, type DemoSong, type StemKey } from './data.ts';
import type { DemoEngine } from './engine.ts';

interface ChannelSpec {
  key: StemKey;
  label: string;
  color: string;
}

/** Master: nao e um stem, e a saida. Fica sempre por ultimo, como numa mesa. */
const MASTER: ChannelSpec = { key: 'master' as StemKey, label: 'Master', color: '#8B96AE' };

function channelsFor(song: DemoSong): ChannelSpec[] {
  return [
    { key: 'click', label: 'Click', color: CLICK_COLOR },
    { key: 'guide', label: 'Guia', color: GUIDE_COLOR },
    ...stemsFor(song).map((s) => ({ key: s.key, label: s.label, color: s.color })),
  ];
}

export function renderMixer(container: HTMLElement, engine: DemoEngine, song: DemoSong, withMaster = true): void {
  container.innerHTML = '';
  const channels = channelsFor(song);

  for (const channel of withMaster ? [...channels, MASTER] : channels) {
    const row = document.createElement('div');
    row.className = `mx-row${(channel.key as string) === 'master' ? ' is-master' : ''}`;
    row.dataset.channel = channel.key;
    row.style.setProperty('--ch-color', channel.color);

    const isGuide = channel.key === 'guide';
    const isMaster = (channel.key as string) === 'master';
    row.innerHTML = `
      <span class="mx-edge"></span>
      <button class="mx-btn" data-act="mute">M</button>
      <button class="mx-btn" data-act="solo">S</button>
      <span class="mx-name">${channel.label}</span>
      <button class="mx-more">⋮</button>
      <input class="mx-fader" type="range" min="0" max="1" step="0.01" value="1">
      <span class="mx-knob"><span class="mx-knob-mark"></span></span>`;

    const mute = row.querySelector<HTMLButtonElement>('[data-act="mute"]')!;
    const solo = row.querySelector<HTMLButtonElement>('[data-act="solo"]')!;
    const fader = row.querySelector<HTMLInputElement>('.mx-fader')!;
    const knob = row.querySelector<HTMLElement>('.mx-knob')!;

    const st = isMaster ? null : engine.state(channel.key);
    if (st) {
      fader.value = String(st.volume);
      mute.classList.toggle('is-on', st.muted);
      solo.classList.toggle('is-on', st.soloed);
    }

    mute.addEventListener('click', () => {
      const active = isMaster ? engine.toggleMasterMute() : engine.toggleMute(channel.key);
      mute.classList.toggle('is-on', active);
    });
    solo.addEventListener('click', () => {
      if (isMaster) return;
      solo.classList.toggle('is-on', engine.toggleSolo(channel.key));
      syncSoloState(container, engine, channels);
    });
    fader.addEventListener('input', () => {
      const value = Number(fader.value);
      if (isMaster) engine.setMasterVolume(value);
      else engine.setVolume(channel.key, value);
    });

    // Knob de pan: arrastar na vertical, como numa mesa.
    let dragging = false;
    let pan = 0;
    const paint = () => knob.style.setProperty('--rot', `${pan * 135}deg`);
    knob.addEventListener('pointerdown', (e) => { dragging = true; knob.setPointerCapture(e.pointerId); });
    knob.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      pan = Math.max(-1, Math.min(1, pan - e.movementY / 60));
      paint();
      if (!isMaster) engine.setPan(channel.key, pan);
    });
    knob.addEventListener('pointerup', () => { dragging = false; });
    knob.addEventListener('dblclick', () => { pan = 0; paint(); if (!isMaster) engine.setPan(channel.key, 0); });
    paint();
    void isGuide;

    container.appendChild(row);
  }
  syncSoloState(container, engine, channels);
}

/**
 * Coluna de canais do Studio: a mesma linha de canal do mixer, uma por lane e
 * com a altura da lane, para M/S/volume/pan ficarem ao lado do que controlam.
 * A cabeca da coluna ocupa a altura da regua + cifras, com os controles
 * globais (mute/solo de todos, follow).
 */
export function renderStrips(container: HTMLElement, engine: DemoEngine, song: DemoSong): void {
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'strips-head';
  head.innerHTML = `
    <span class="strips-tools">
      <button class="st-ico on" title="Selecionar">⬚</button>
      <button class="st-ico" title="Cortar seção">✂</button>
      <button class="st-ico" data-act="mute-all" title="Silenciar tudo">🔇</button>
    </span>
    <span class="strips-global">
      <button class="mx-btn" data-act="unmute-all" title="Tirar todos os mutes">M</button>
      <button class="mx-btn" data-act="unsolo-all" title="Tirar todos os solos">S</button>
    </span>`;
  container.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'strips-rows';
  renderMixer(rows, engine, song, false);
  for (const row of Array.from(rows.children) as HTMLElement[]) {
    const key = row.dataset.channel;
    row.classList.add('strip', key === 'click' ? 'is-click' : key === 'guide' ? 'is-guide' : 'is-stem');
  }
  container.appendChild(rows);

  head.querySelector('[data-act="unmute-all"]')!.addEventListener('click', () => {
    for (const row of rows.querySelectorAll<HTMLElement>('.mx-row')) {
      const key = row.dataset.channel as StemKey;
      if (engine.state(key).muted) { engine.toggleMute(key); row.querySelector('[data-act="mute"]')!.classList.remove('is-on'); }
    }
  });
  head.querySelector('[data-act="unsolo-all"]')!.addEventListener('click', () => {
    for (const row of rows.querySelectorAll<HTMLElement>('.mx-row')) {
      const key = row.dataset.channel as StemKey;
      if (engine.state(key).soloed) { engine.toggleSolo(key); row.querySelector('[data-act="solo"]')!.classList.remove('is-on'); }
      row.classList.remove('is-dimmed');
    }
  });
  head.querySelector('[data-act="mute-all"]')!.addEventListener('click', () => {
    for (const row of rows.querySelectorAll<HTMLElement>('.mx-row')) {
      const key = row.dataset.channel as StemKey;
      if (!engine.state(key).muted) { engine.toggleMute(key); row.querySelector('[data-act="mute"]')!.classList.add('is-on'); }
    }
  });
}

/** Quando ha solo, os outros canais aparecem apagados — igual a uma mesa. */
function syncSoloState(container: HTMLElement, engine: DemoEngine, channels: ChannelSpec[]): void {
  const anySolo = channels.some((c) => engine.state(c.key).soloed);
  for (const row of Array.from(container.children) as HTMLElement[]) {
    const solo = row.querySelector('[data-act="solo"]')!;
    row.classList.toggle('is-dimmed', anySolo && !solo.classList.contains('is-on'));
  }
}

/**
 * Faders do palco: a coluna direita do Live Mode. Verticais, grandes, so o
 * essencial — volume e solo por canal, master no topo. A mesa completa (pan,
 * mute) fica no Mixer; ao vivo, o que se mexe e isto.
 */
export function renderLiveFaders(container: HTMLElement, engine: DemoEngine, song: DemoSong): void {
  container.innerHTML = '';
  const list = [MASTER, ...channelsFor(song)];
  for (const channel of list) {
    const isMaster = (channel.key as string) === 'master';
    const strip = document.createElement('div');
    strip.className = `lf-strip${isMaster ? ' is-master' : ''}`;
    strip.style.setProperty('--ch-color', channel.color);
    const st = isMaster ? { volume: 0.85, muted: false, soloed: false } : engine.state(channel.key);
    strip.innerHTML = `
      <button class="lf-solo${st.soloed ? ' is-on' : ''}" ${isMaster ? 'disabled' : ''}>S</button>
      <div class="lf-fader-wrap"><input class="lf-fader" type="range" min="0" max="1" step="0.01" value="${st.volume}" orient="vertical"></div>
      <span class="lf-name">${channel.label}</span>`;
    const fader = strip.querySelector<HTMLInputElement>('.lf-fader')!;
    const solo = strip.querySelector<HTMLButtonElement>('.lf-solo')!;
    fader.addEventListener('input', () => {
      const v = Number(fader.value);
      if (isMaster) engine.setMasterVolume(v);
      else engine.setVolume(channel.key, v);
    });
    solo.addEventListener('click', () => {
      if (isMaster) return;
      solo.classList.toggle('is-on', engine.toggleSolo(channel.key));
      const anySolo = list.some((c) => (c.key as string) !== 'master' && engine.state(c.key).soloed);
      for (const s of Array.from(container.children) as HTMLElement[]) {
        s.classList.toggle('is-dimmed', anySolo && !s.classList.contains('is-master') && !s.querySelector('.lf-solo')!.classList.contains('is-on'));
      }
    });
    container.appendChild(strip);
  }
}
