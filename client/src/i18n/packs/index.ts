/**
 * Translation packs for the dApp Store languages other than Italian and English (the source tables).
 * Every pack must cover every key (enforced by the `Pack` type and i18n.test.ts); placeholders like {n}
 * stay untranslated. Machine-authored by Claude on 2026-11-02: have native speakers review before a
 * store launch, the Daily Pass texts first.
 */
import type { UiKey } from '../../ui/i18n';
import type { MetaKey } from '../../meta/strings';
import type { PassKey } from '../../pass/ui/copy';
import type { DetailsKey } from '../../pass/ui/details';
import type { Lang } from '../lang';
import ar from './ar';
import de from './de';
import es from './es';
import fr from './fr';
import hi from './hi';
import ja from './ja';
import ko from './ko';
import nl from './nl';
import pl from './pl';
import pt from './pt';
import ru from './ru';
import th from './th';
import uk from './uk';
import zh from './zh';
import zhTW from './zh-TW';

export interface Pack {
  ui: Record<UiKey, string>;
  meta: Record<MetaKey, string>;
  pass: Record<PassKey, string>;
  details: Record<DetailsKey, string>;
}

export const PACKS: Partial<Record<Lang, Pack>> = { ar, de, es, fr, hi, ja, ko, nl, pl, pt, ru, th, uk, zh, 'zh-TW': zhTW };
