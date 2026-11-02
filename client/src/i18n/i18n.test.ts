import { describe, expect, it } from 'vitest';
import { PACKS, type Pack } from './packs';
import { LANGS, matchLang } from './lang';
import { UI_COPY } from '../ui/i18n';
import { META_COPY } from '../meta/strings';
import { PASS_COPY } from '../pass/ui/copy';
import { DETAILS_COPY } from '../pass/ui/details';

const EN: Pack = { ui: UI_COPY.en, meta: META_COPY.en, pass: PASS_COPY.en, details: DETAILS_COPY.en };
const holes = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();

describe('translations (17 dApp Store languages)', () => {
  it('a pack for every language except the it/en sources', () => {
    for (const l of LANGS) if (l !== 'it' && l !== 'en') expect(PACKS[l], l).toBeDefined();
  });
  for (const [lang, pack] of Object.entries(PACKS) as [string, Pack][]) {
    it(`${lang}: every key, same placeholders as English, nothing empty`, () => {
      for (const ns of ['ui', 'meta', 'pass', 'details'] as const) {
        expect(Object.keys(pack[ns]).sort(), `${lang}.${ns}`).toEqual(Object.keys(EN[ns]).sort());
        for (const [k, v] of Object.entries(pack[ns])) {
          expect(v.trim().length, `${lang}.${ns}.${k}`).toBeGreaterThan(0);
          expect(holes(v), `${lang}.${ns}.${k}`).toEqual(holes((EN[ns] as Record<string, string>)[k]!));
        }
      }
    });
    it(`${lang}: the pass panel never shows the technical words (rule of check-player-copy)`, () => {
      for (const [k, v] of Object.entries(pack.pass)) expect(v, k).not.toMatch(/SWANGY|PASTA|timelock|lock|Meteora|pool|mint/i);
      expect(pack.pass.offer).toMatch(/0[.,]01 SOL/);
      expect(pack.details.fee).toMatch(/2\s?%/);
    });
  }
  it('device languages map to game languages', () => {
    expect(matchLang('it-IT')).toBe('it');
    expect(matchLang('pt-BR')).toBe('pt');
    expect(matchLang('zh-Hant-TW')).toBe('zh-TW');
    expect(matchLang('zh-HK')).toBe('zh-TW');
    expect(matchLang('zh-CN')).toBe('zh');
    expect(matchLang('sv-SE')).toBeNull();
  });
});
