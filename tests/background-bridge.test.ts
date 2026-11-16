import { describe, expect, it } from 'vitest';
import { isLookupRequest, isLookupResponse } from '../src/providers/background-bridge';

describe('isLookupRequest', () => {
  it('принимает корректный запрос', () => {
    expect(
      isLookupRequest({
        type: 'kataoke:lookup',
        track: { title: 'Группа крови', artist: 'Кино', durationSec: 271 },
      }),
    ).toBe(true);
  });

  it('отвергает чужие сообщения', () => {
    expect(isLookupRequest({ type: 'другое', track: { title: 'a', artist: 'b' } })).toBe(false);
    expect(isLookupRequest(null)).toBe(false);
    expect(isLookupRequest('kataoke:lookup')).toBe(false);
  });

  it('отвергает запрос без обязательных полей трека', () => {
    expect(isLookupRequest({ type: 'kataoke:lookup', track: { title: 'a' } })).toBe(false);
    expect(isLookupRequest({ type: 'kataoke:lookup' })).toBe(false);
  });
});

describe('isLookupResponse', () => {
  it('принимает ответ с результатом', () => {
    expect(isLookupResponse({ ok: true, result: null })).toBe(true);
  });

  it('принимает ответ с ошибкой', () => {
    expect(isLookupResponse({ ok: false, error: 'HTTP 500' })).toBe(true);
  });

  it('отвергает ответ без полей', () => {
    expect(isLookupResponse({ ok: false })).toBe(false);
    expect(isLookupResponse(undefined)).toBe(false);
  });
});