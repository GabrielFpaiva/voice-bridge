import type { Status } from '../core/state';

export interface View {
  label: string;
  hint: string;
  canToggle: boolean;
}

export function describeStatus(status: Status, onMeet: boolean, missing: string[]): View {
  switch (status) {
    case 'connecting':
      return { label: 'Conectando…', hint: 'Microfone normal enquanto conecta.', canToggle: true };
    case 'translating':
      return { label: 'Traduzindo PT → EN', hint: 'Toque nos bits ou Alt+T para desligar.', canToggle: true };
    case 'failed':
      return { label: 'Conexão caiu', hint: 'Microfone voltou ao normal. Reconectando…', canToggle: true };
    case 'off':
      if (missing.length) return { label: 'Desligado', hint: 'Preencha as chaves abaixo para ligar.', canToggle: false };
      if (!onMeet) return { label: 'Desligado', hint: 'Abra uma reunião do Meet para ligar.', canToggle: false };
      return { label: 'Desligado', hint: 'Toque nos bits ou Alt+T para ligar.', canToggle: true };
  }
}
