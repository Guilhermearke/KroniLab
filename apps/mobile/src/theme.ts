/**
 * Direcao visual: escuro, premium, musical. Nao pode parecer ERP.
 *
 * O contraste alto nao e estetica — e requisito de palco: a tela e lida de
 * relance, no escuro, com a luz do refletor batendo nela.
 */
export const colors = {
  bg: '#07090F',
  surface: '#101420',
  surfaceHigh: '#171D2C',
  line: '#232B3D',
  text: '#F2F5FC',
  textMuted: '#8E9AB5',
  // Ambar: a cor do "agora" (secao tocando, gravando, ao vivo).
  accent: '#F0A81F',
  accentSoft: '#3A2B0C',
  // Azul: o "proximo" (enfileirado, agendado).
  queued: '#5B8CFF',
  ok: '#33C98A',
  warn: '#F0A81F',
  danger: '#F2555A',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const type = {
  // Tamanhos de palco: o operador esta a um braco de distancia do tablet.
  liveTitle: 34,
  liveSection: 44,
  title: 24,
  heading: 18,
  body: 15,
  label: 13,
  micro: 11,
} as const;
