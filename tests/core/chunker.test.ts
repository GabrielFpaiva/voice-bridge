import { describe, expect, it } from 'vitest';
import { Chunker } from '../../src/core/chunker';

describe('Chunker', () => {
  it('closes a chunk at a comma after at least 2 stable words', () => {
    const c = new Chunker();
    expect(c.push('Olá pessoal, tudo bem com')).toEqual(['Olá pessoal,']);
  });

  it('never emits the last word of a partial (it may still change)', () => {
    const c = new Chunker();
    expect(c.push('Olá pessoal,')).toEqual([]);
    expect(c.push('Olá pessoal, tudo')).toEqual(['Olá pessoal,']);
  });

  it('does not re-emit what was already emitted', () => {
    const c = new Chunker();
    c.push('Olá pessoal, tudo bem com');
    expect(c.push('Olá pessoal, tudo bem com vocês')).toEqual([]);
  });

  it('closes a chunk every 5 stable words when there is no punctuation', () => {
    const c = new Chunker();
    const text = 'eu queria falar sobre o projeto que a gente começou semana passada e agora';
    expect(c.push(text)).toEqual(['eu queria falar sobre o', 'projeto que a gente começou']);
  });

  it('closes immediately at sentence end even with a single word', () => {
    const c = new Chunker();
    expect(c.push('Sim. Então')).toEqual(['Sim.']);
  });

  it('commit returns the unemitted rest as one chunk and resets', () => {
    const c = new Chunker();
    c.push('Olá pessoal, tudo bem com');
    expect(c.commit('Olá pessoal, tudo bem com vocês?')).toEqual(['tudo bem com vocês?']);
    expect(c.push('Novo trecho aqui agora')).toEqual([]);
    expect(c.commit('Novo trecho aqui agora.')).toEqual(['Novo trecho aqui agora.']);
  });

  it('commit with fewer words than already emitted returns nothing and resets', () => {
    const c = new Chunker();
    c.push('um dois três quatro cinco seis');
    expect(c.commit('um dois')).toEqual([]);
    expect(c.commit('')).toEqual([]);
  });

  it('handles empty and whitespace-only input', () => {
    const c = new Chunker();
    expect(c.push('')).toEqual([]);
    expect(c.push('   ')).toEqual([]);
    expect(c.commit('   ')).toEqual([]);
  });
});
