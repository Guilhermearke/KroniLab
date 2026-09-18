/**
 * Pad: o colchao que segura o tom por baixo do culto.
 *
 * Duas coisas fazem o pad soar profissional e as duas sao rampas:
 *   - entrar e sair em fade, nunca em corte;
 *   - na troca de tom, o tom novo entra ENQUANTO o velho sai. Sem a
 *     sobreposicao existe um buraco audivel entre uma musica e outra.
 *
 * Os tempos vem do @kronilab/core (planPadFade / planPadKeyChange), os mesmos
 * usados pelo app.
 */
import { planPadFade, planPadKeyChange } from '@kronilab/core';

/** Um banco de osciladores tocando um tom. Trocar de tom = trocar de banco. */
interface PadVoice {
  gain: GainNode;
  oscillators: OscillatorNode[];
  key: string;
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_TO_FLAT: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

export class PadPlayer {
  private voice: PadVoice | null = null;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;

  enabled = false;

  constructor(private ctx: AudioContext, destination: AudioNode, private level = 0.18) {
    const bus = ctx.createGain();
    bus.gain.value = level;

    // Passa-baixa com movimento lento: e o que diferencia um pad de um acorde
    // parado de orgao.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    bus.connect(filter).connect(destination);
    this.bus = bus;
    this.filter = filter;
    this.lfo = lfo;
  }

  /** Liga o pad no tom indicado, com fade de entrada. */
  start(key: string, fadeSec?: number): void {
    this.enabled = true;
    if (this.voice?.key === key) return;
    const fade = planPadFade('in', this.ctx.currentTime, fadeSec);
    this.voice = this.buildVoice(key);
    this.rampVoice(this.voice, fade.from, fade.to, fade.durationSec);
  }

  /**
   * Troca o tom com sobreposicao: o banco antigo sai enquanto o novo entra.
   * Se o tom for o mesmo, nao faz nada — pad piscando a toa chama atencao.
   */
  setKey(key: string, fadeSec?: number): void {
    if (!this.enabled) return;
    if (this.voice?.key === key) return;
    const { out, in: fadeIn } = planPadKeyChange(this.ctx.currentTime, fadeSec);

    const old = this.voice;
    if (old) {
      this.rampVoice(old, 1, out.to, out.durationSec);
      // So descarta depois que a rampa terminou; parar antes seria um corte.
      window.setTimeout(() => this.disposeVoice(old), out.durationSec * 1000 + 200);
    }
    this.voice = this.buildVoice(key);
    this.rampVoice(this.voice, fadeIn.from, fadeIn.to, fadeIn.durationSec);
  }

  stop(fadeSec?: number): void {
    this.enabled = false;
    const voice = this.voice;
    if (!voice) return;
    const fade = planPadFade('out', this.ctx.currentTime, fadeSec);
    this.rampVoice(voice, 1, fade.to, fade.durationSec);
    window.setTimeout(() => this.disposeVoice(voice), fade.durationSec * 1000 + 200);
    this.voice = null;
  }

  currentKey(): string | null {
    return this.voice?.key ?? null;
  }

  private buildVoice(key: string): PadVoice {
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.bus!);

    const root = this.rootHz(key);
    // Tonica, quinta, oitava e terca — intervalos que sustentam qualquer
    // cancao sem brigar com o acorde que a banda esta tocando.
    const ratios = [1, 1.5, 2, 2.5];
    const oscillators = ratios.flatMap((ratio) => {
      // Par levemente desafinado: o batimento entre os dois e o que da corpo.
      return [-4, 4].map((detune) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = root * ratio;
        osc.detune.value = detune;
        const voiceGain = this.ctx.createGain();
        voiceGain.gain.value = ratio >= 2 ? 0.16 : 0.3;
        osc.connect(voiceGain).connect(gain);
        osc.start();
        return osc;
      });
    });

    return { gain, oscillators, key };
  }

  private rampVoice(voice: PadVoice, from: number, to: number, seconds: number): void {
    const now = this.ctx.currentTime;
    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, from), now);
    // Exponencial: o ouvido percebe volume em escala logaritmica, entao uma
    // rampa linear soa como se o pad "pulasse" no fim.
    g.exponentialRampToValueAtTime(Math.max(0.0001, to), now + seconds);
  }

  private disposeVoice(voice: PadVoice): void {
    for (const osc of voice.oscillators) {
      try { osc.stop(); } catch { /* ja parado */ }
      osc.disconnect();
    }
    voice.gain.disconnect();
  }

  private rootHz(key: string): number {
    const normalized = SHARP_TO_FLAT[key] ?? key;
    const index = Math.max(0, NAMES.indexOf(normalized));
    // A2 = 110 Hz como referencia: grave o bastante para nao mascarar o vocal.
    return 110 * Math.pow(2, index / 12);
  }
}
