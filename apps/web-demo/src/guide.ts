/**
 * Guia: a voz que avisa a proxima secao antes de ela chegar.
 *
 * O que faz uma guia ser confiavel e a ANTECEDENCIA, nao a voz: o musico
 * precisa ouvir "refrao" com tempo de se preparar. Por isso o aviso e
 * agendado pelo relogio de audio para cair um compasso (ou dois tempos)
 * antes da secao, descontando a latencia de a voz comecar a falar.
 *
 * SpeechSynthesis nao aceita "fale em t=12.340s"; aceita "fale agora". Entao
 * o agendamento e nosso: um timer curto, calibrado pelo AudioContext, chama
 * speak() no instante certo. Quando nao ha voz pt-BR disponivel, a guia vira
 * um bipe de duas notas — pior que voz, melhor que silencio.
 */

import { guideSampleFor, type SampleBank, type SampleName } from './samples.ts';

export type GuideLead = 'bar' | 'two-beats';
export type GuideVoiceMode = 'voice' | 'tone' | 'off';

export interface GuideSettings {
  mode: GuideVoiceMode;
  lead: GuideLead;
  rate: number;
  voiceName: string | null;
}

/** Latencia tipica entre speak() e o som sair. Compensada no agendamento. */
const SPEECH_LATENCY_SEC = 0.14;

/** Como a secao e falada: curto, claro, no ritmo da banda. */
export function spokenLabel(label: string): string {
  return label
    .replace(/^Pre-refrao/i, 'Pré-refrão')
    .replace(/^Refrao/i, 'Refrão')
    .replace(/^Intro$/i, 'Intro')
    .replace(/^Final$/i, 'Final')
    .replace(/\s(\d+)$/, ' $1');
}

export class Guide {
  settings: GuideSettings = { mode: 'voice', lead: 'bar', rate: 1.1, voiceName: null };
  private timer: number | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private toneOut: AudioNode;
  /** Contagem falada ("um, dois, tres, quatro") no ultimo compasso da pre-contagem. */
  spokenCount = true;

  constructor(private ctx: AudioContext, out: AudioNode, private samples: SampleBank | null = null) {
    this.toneOut = out;
    this.loadVoices();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => this.loadVoices());
    }
  }

  private loadVoices(): void {
    if (typeof speechSynthesis === 'undefined') return;
    this.voices = speechSynthesis.getVoices().filter((v) => /^pt(-|_)?BR/i.test(v.lang));
  }

  /** Vozes pt-BR disponiveis, com as mais naturais primeiro. */
  availableVoices(): SpeechSynthesisVoice[] {
    const score = (v: SpeechSynthesisVoice) =>
      (/google/i.test(v.name) ? 3 : 0) + (/luciana|felipe|francisca|thalita/i.test(v.name) ? 2 : 0)
      + (/premium|enhanced|natural|neural/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
    return [...this.voices].sort((a, b) => score(b) - score(a));
  }

  hasVoice(): boolean {
    return this.voices.length > 0;
  }

  /**
   * Um toque do usuario destrava a sintese de voz no iOS/Safari. Chamar no
   * primeiro play: fala um utterance vazio e pronto.
   */
  prime(): void {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  /**
   * Agenda o aviso para o instante `atCtxTime` do relogio de audio.
   * Amostra gravada primeiro (timing exato); TTS quando a secao nao tem
   * amostra; bipe quando nao ha voz nenhuma.
   */
  cueAt(text: string, atCtxTime: number): void {
    this.cancel();
    if (this.settings.mode === 'off') return;
    if (this.settings.mode === 'voice') {
      const sample = guideSampleFor(text);
      if (sample && this.samples?.has(sample)) {
        this.samples.play(sample, atCtxTime, this.toneOut, 1);
        return;
      }
    }
    const useVoice = this.settings.mode === 'voice' && this.hasVoice();
    if (!useVoice) {
      this.tone(atCtxTime);
      return;
    }
    const delay = (atCtxTime - this.ctx.currentTime - SPEECH_LATENCY_SEC) * 1000;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.speak(text);
    }, Math.max(0, delay));
  }

  cancel(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }

  /** "um, dois, tres, quatro" nos instantes dados (um por tempo). */
  countAt(beatCtxTimes: number[]): void {
    if (this.settings.mode !== 'voice' || !this.spokenCount || !this.samples) return;
    beatCtxTimes.slice(0, 4).forEach((when, i) => {
      this.samples!.play(`conta-${i + 1}` as SampleName, when, this.toneOut, 1);
    });
  }

  private speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(spokenLabel(text));
    u.lang = 'pt-BR';
    u.rate = this.settings.rate;
    u.pitch = 1;
    const wanted = this.settings.voiceName;
    const voice = (wanted && this.voices.find((v) => v.name === wanted)) || this.availableVoices()[0];
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  /** Bipe de duas notas (sobe): o "atencao" universal quando nao ha voz. */
  private tone(when: number): void {
    const ctx = this.ctx;
    for (const [i, freq] of [[0, 880], [0.11, 1320]] as const) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(env).connect(this.toneOut);
      const t = when + i;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }
}
