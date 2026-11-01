import { t } from '../ui/i18n';
import { EMPTY_CARD_URL, fetchSponsors, pickOnce, type Sponsor } from './feed';

/**
 * Menu-only sponsor card. Built with DOM APIs and textContent (feed text is never parsed as markup).
 * A link opens only on an explicit tap/click; an expired sponsor turns into the empty card without
 * picking another one. No wallet data, score or identifier is sent; the feed gets ordinary network info.
 */
export function mountSponsorCard(host: HTMLElement): void {
  const card = document.createElement('a');
  card.className = 'sponsor';
  card.target = '_blank';
  card.rel = 'noopener noreferrer sponsored';
  const label = document.createElement('span');
  label.className = 'sponsor-label';
  label.textContent = t('sponsor.paid');
  const body = document.createElement('span');
  body.className = 'sponsor-body';
  const note = document.createElement('span');
  note.className = 'sponsor-note';
  card.append(label, body, note);
  host.append(card);

  const showEmpty = (): void => {
    card.href = EMPTY_CARD_URL;
    body.replaceChildren(document.createTextNode(t('sponsor.empty')));
    note.textContent = '';
    card.dataset.state = 'empty';
  };
  const show = (s: Sponsor): void => {
    card.href = s.url;
    body.replaceChildren();
    if (s.logo) {
      const img = document.createElement('img');
      img.src = s.logo;
      img.alt = '';
      img.width = 28; img.height = 28;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      body.append(img);
    }
    body.append(document.createTextNode(`${s.name} · ${s.symbol}`));
    note.textContent = t('sponsor.disclaimer');
    card.dataset.state = 'sponsor';
    const ms = s.expiresAt - Date.now();
    if (ms > 0 && ms < 2 ** 31) setTimeout(showEmpty, ms);
  };

  showEmpty();
  void fetchSponsors().then((list) => { const s = pickOnce(list); if (s && s.expiresAt > Date.now()) show(s); });
}
