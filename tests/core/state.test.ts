import { describe, expect, it } from 'vitest';
import { isPassthrough, next } from '../../src/core/state';

describe('state machine', () => {
  it('off -> connecting on toggle', () => {
    expect(next('off', { type: 'toggle' })).toBe('connecting');
  });

  it('connecting -> translating on connected', () => {
    expect(next('connecting', { type: 'connected' })).toBe('translating');
  });

  it('connecting or translating -> failed on error', () => {
    expect(next('connecting', { type: 'error' })).toBe('failed');
    expect(next('translating', { type: 'error' })).toBe('failed');
  });

  it('failed -> connecting on retry, and stays connecting on repeated retry', () => {
    expect(next('failed', { type: 'retry' })).toBe('connecting');
    expect(next('connecting', { type: 'retry' })).toBe('connecting');
  });

  it('toggle from any active state goes to off', () => {
    expect(next('connecting', { type: 'toggle' })).toBe('off');
    expect(next('translating', { type: 'toggle' })).toBe('off');
    expect(next('failed', { type: 'toggle' })).toBe('off');
  });

  it('ignores events that make no sense in the current state', () => {
    expect(next('off', { type: 'connected' })).toBe('off');
    expect(next('off', { type: 'error' })).toBe('off');
    expect(next('translating', { type: 'connected' })).toBe('translating');
  });

  it('only passes the real mic through when not translating', () => {
    expect(isPassthrough('off')).toBe(true);
    expect(isPassthrough('connecting')).toBe(true);
    expect(isPassthrough('failed')).toBe(true);
    expect(isPassthrough('translating')).toBe(false);
  });
});
