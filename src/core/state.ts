export type Status = 'off' | 'connecting' | 'translating' | 'failed';
export type StateEvent = { type: 'toggle' | 'connected' | 'error' | 'retry' };

export function next(s: Status, e: StateEvent): Status {
  if (e.type === 'toggle') return s === 'off' ? 'connecting' : 'off';
  if (s === 'off') return s;
  if (e.type === 'connected') return s === 'connecting' ? 'translating' : s;
  if (e.type === 'error') return 'failed';
  if (e.type === 'retry') return 'connecting';
  return s;
}

export function isPassthrough(s: Status): boolean {
  return s !== 'translating';
}
