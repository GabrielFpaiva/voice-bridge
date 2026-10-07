import type { Status } from '../core/state';
import type { Counts } from '../shared/messages';

export interface View {
  label: string;
  hint: string;
  canToggle: boolean;
}

export function statsLine(c: Counts): string {
  return `mic ${c.mic} · texto ${c.text} · trad ${c.translated} · voz ${c.voice}`;
}

export function savedLabel(elevenKey: string): string {
  return elevenKey ? `salvo · chave …${elevenKey.slice(-4)}` : 'salvo';
}

// A failure is almost always a bad setting: once the user edits one, drop the stale error.
export function resetsAfterEdit(status: Status): boolean {
  return status === 'failed';
}

export function describeStatus(status: Status, onMeet: boolean, missing: string[], detail?: string, stats?: Counts): View {
  switch (status) {
    case 'connecting':
      return { label: 'Conectando…', hint: 'Microfone normal enquanto conecta.', canToggle: true };
    case 'translating':
      return { label: 'Traduzindo PT → EN', hint: stats ? statsLine(stats) : 'Toque nos bits ou Alt+T para desligar.', canToggle: true };
    case 'failed':
      return { label: 'Conexão caiu', hint: detail ?? 'Microfone voltou ao normal. Reconectando…', canToggle: true };
    case 'off':
      if (missing.length) return { label: 'Desligado', hint: 'Preencha as chaves abaixo para ligar.', canToggle: false };
      if (!onMeet) return { label: 'Desligado', hint: 'Abra uma reunião do Meet para ligar.', canToggle: false };
      return { label: 'Desligado', hint: 'Toque nos bits ou Alt+T para ligar.', canToggle: true };
  }
}
