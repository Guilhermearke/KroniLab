/**
 * Mixer: um canal por stem, com M/S, volume e pan.
 *
 * O solo e resolvido na engine (uma fonte de verdade), nao aqui. A tela so
 * reflete o estado — se o mixer calculasse ganho por conta propria, mixer e
 * audio divergiriam no primeiro solo.
 */
import { CLICK_COLOR, GUIDE_COLOR, STEMS, type StemKey } from './data.ts';
import type { DemoEngine } from './engine.ts';

interface ChannelSpec {
  key: StemKey;
  label: string;
  color: string;
}

/** Master: nao e um stem, e a saida. Fica sempre por ultimo, como numa mesa. */
const MASTER: ChannelSpec = { key: 'master' as StemKey, label: 'Master', color: '#8B96AE' };

const CHANNELS: ChannelSpec[] = [
  { key: 'click', label: 'Click', color: CLICK_COLOR },
  { key: 'guide', label: 'Guia', color: GUIDE_COLOR },
  ...STEMS.map((s) => ({ key: s.key, label: s.label, color: s.color })),
];

export function renderMixer(container: HTMLElement, engine: DemoEngine): void {
  container.innerHTML = '';

  for (const channel of [...CHANNELS, MASTER]) {
    const row = document.createElement('div');
    row.className = `mx-row${(channel.key as string) === 'master' ? ' is-master' : ''}`;
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

    mute.addEventListener('click', () => {
      // A guia e falada pelo navegador: nao passa pelo canal de sintese.
      const active = isMaster ? engine.toggleMasterMute()
        : isGuide ? toggleGuide(engine)
        : engine.toggleMute(channel.key);
      mute.classList.toggle('is-on', active);
    });
    solo.addEventListener('click', () => {
      if (isGuide || isMaster) return;
      solo.classList.toggle('is-on', engine.toggleSolo(channel.key));
      syncSoloState(container, engine);
    });
    fader.addEventListener('input', () => {
      const value = Number(fader.value);
      if (isMaster) engine.setMasterVolume(value);
      else if (!isGuide) engine.setVolume(channel.key, value);
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
      if (!isGuide && !isMaster) engine.setPan(channel.key, pan);
    });
    knob.addEventListener('pointerup', () => { dragging = false; });
    knob.addEventListener('dblclick', () => { pan = 0; paint(); if (!isGuide && !isMaster) engine.setPan(channel.key, 0); });
    paint();

    container.appendChild(row);
  }
}

function toggleGuide(engine: DemoEngine): boolean {
  engine.guideOn = !engine.guideOn;
  return !engine.guideOn;
}

/** Quando ha solo, os outros canais aparecem apagados — igual a uma mesa. */
function syncSoloState(container: HTMLElement, engine: DemoEngine): void {
  const anySolo = STEMS.some((s) => engine.state(s.key).soloed)
    || engine.state('click').soloed;
  for (const row of Array.from(container.children) as HTMLElement[]) {
    const solo = row.querySelector('[data-act="solo"]')!;
    row.classList.toggle('is-dimmed', anySolo && !solo.classList.contains('is-on'));
  }
}
