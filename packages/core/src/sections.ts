/** Secoes da musica — sempre ancoradas em compasso, nunca em timestamp solto. */
import { timeOfBar, barCount } from './beatgrid.ts';
import type { BeatGrid, Section, SectionType } from './types.ts';

const PT_BR: Record<SectionType, string> = {
  Intro: 'Intro',
  Verse: 'Verso',
  PreChorus: 'Pre-refrao',
  Chorus: 'Refrao',
  Bridge: 'Ponte',
  Instrumental: 'Instrumental',
  Solo: 'Solo',
  Break: 'Break',
  Outro: 'Final',
};

export function sectionLabel(type: SectionType, occurrence = 1): string {
  const base = PT_BR[type];
  return occurrence > 1 ? `${base} ${occurrence}` : base;
}

/** Rotula uma sequencia crua do analisador: Verso, Refrao, Verso 2, Refrao 2... */
export function labelSections(types: SectionType[]): string[] {
  const seen = new Map<SectionType, number>();
  return types.map((t) => {
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return sectionLabel(t, n);
  });
}

export function sectionAtBar(sections: Section[], bar: number): Section | null {
  for (const s of sections) {
    if (bar >= s.startBar && bar < s.endBar) return s;
  }
  return null;
}

export interface SectionTiming {
  section: Section;
  startTime: number;
  endTime: number;
}

export function sectionTiming(grid: BeatGrid, section: Section): SectionTiming {
  return {
    section,
    startTime: timeOfBar(grid, section.startBar),
    endTime: timeOfBar(grid, section.endBar),
  };
}

export function withTimings(grid: BeatGrid, sections: Section[]): SectionTiming[] {
  return sections.map((s) => sectionTiming(grid, s));
}

export function sectionAtTime(grid: BeatGrid, sections: Section[], time: number): Section | null {
  for (const s of sections) {
    const { startTime, endTime } = sectionTiming(grid, s);
    if (time >= startTime && time < endTime) return s;
  }
  return null;
}

/** Proxima secao na ordem do arranjo (nao no tempo) — alimenta "Proximo:" no live. */
export function nextSection(sections: Section[], currentId: string | null): Section | null {
  if (!currentId) return sections[0] ?? null;
  const i = sections.findIndex((s) => s.id === currentId);
  if (i < 0) return sections[0] ?? null;
  return sections[i + 1] ?? null;
}

/** Aplica um arranjo (ordem/repeticao de secoes) sobre as secoes analisadas. */
export function applyArrangement(sections: Section[], sectionIds: string[]): Section[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const out: Section[] = [];
  for (const id of sectionIds) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}

/** Valida secoes contra a grade: sem buraco, sem sobreposicao, dentro da musica. */
export function validateSections(grid: BeatGrid, sections: Section[]): string[] {
  const problems: string[] = [];
  const total = barCount(grid);
  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar);
  let prevEnd: number | null = null;
  for (const s of sorted) {
    if (s.endBar <= s.startBar) problems.push(`${s.label}: compasso final <= inicial`);
    if (s.startBar < 1) problems.push(`${s.label}: comeca antes do compasso 1`);
    if (total > 0 && s.startBar > total) problems.push(`${s.label}: comeca depois do fim da musica`);
    if (prevEnd !== null && s.startBar < prevEnd) problems.push(`${s.label}: sobrepoe a secao anterior`);
    if (prevEnd !== null && s.startBar > prevEnd) problems.push(`${s.label}: deixa buraco no compasso ${prevEnd}`);
    prevEnd = s.endBar;
  }
  return problems;
}
