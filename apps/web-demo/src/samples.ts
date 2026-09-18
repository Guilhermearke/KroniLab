/**
 * Banco de amostras: click e vozes da guia como audio gravado.
 *
 * Amostra e melhor que sintese/TTS em duas coisas que importam no palco:
 * o timing e EXATO (start() no relogio de audio, sem latencia de voz) e o som
 * e sempre o mesmo em qualquer aparelho. Quando uma amostra nao existe (voz
 * de uma secao com nome diferente), a guia cai para TTS.
 *
 * Origem: recortes de exportacao do CueWee feitos pelo dono do projeto.
 * Trocar por amostras proprias antes de virar produto pago — nota em
 * docs/REFERENCIAS.md.
 */

export type SampleName =
  | 'click-blip'
  | 'guia-verso' | 'guia-refrao' | 'guia-instrumental' | 'guia-saida'
  | 'conta-1' | 'conta-2' | 'conta-3' | 'conta-4';

const ALL: SampleName[] = [
  'click-blip',
  'guia-verso', 'guia-refrao', 'guia-instrumental', 'guia-saida',
  'conta-1', 'conta-2', 'conta-3', 'conta-4',
];

export class SampleBank {
  private buffers = new Map<SampleName, AudioBuffer>();
  private loading: Promise<void> | null = null;

  constructor(private ctx: AudioContext, private baseUrl = './samples/') {}

  /** Carrega tudo em paralelo; falha silenciosa por amostra (fica sem ela). */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = Promise.all(ALL.map(async (name) => {
      try {
        const res = await fetch(`${this.baseUrl}${name}.wav`);
        if (!res.ok) return;
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name, buffer);
      } catch { /* sem a amostra: sintese/TTS cobre */ }
    })).then(() => undefined);
    return this.loading;
  }

  get(name: SampleName): AudioBuffer | null {
    return this.buffers.get(name) ?? null;
  }

  has(name: SampleName): boolean {
    return this.buffers.has(name);
  }

  /** Toca uma amostra no instante `when` do relogio, por um no de saida. */
  play(name: SampleName, when: number, out: AudioNode, gain = 1): AudioBufferSourceNode | null {
    const buffer = this.buffers.get(name);
    if (!buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(Math.max(when, this.ctx.currentTime));
    return src;
  }
}

/** Qual amostra fala uma secao: "Refrao 2" -> guia-refrao; "Final" -> guia-saida. */
export function guideSampleFor(label: string): SampleName | null {
  const l = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^verso/.test(l)) return 'guia-verso';
  if (/^refrao|^coro/.test(l)) return 'guia-refrao';
  if (/^instrumental|^solo/.test(l)) return 'guia-instrumental';
  if (/^final|^saida|^outro/.test(l)) return 'guia-saida';
  return null;
}
