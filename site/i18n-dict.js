// Site strings. English lives in the HTML (default, indexed); this dictionary restores it and adds Italian.
window.SS_I18N = {
  en: {},
  it: {
    'nav.features': 'Caratteristiche', 'nav.maps': 'Mappe', 'nav.pass': 'Daily Pass', 'nav.faq': 'Domande',
    'hero.badge': 'Pensato per il Solana Seeker',
    'hero.title': 'Piazza la carica. Tieni la linea. Vinci il round.',
    'hero.sub': 'Round rapidi di attacco e difesa da sei minuti, quattro mappe, partite online con voce di squadra e classifica settimanale. Una partita gratuita ogni giorno.',
    'hero.cta': 'Presto sul dApp Store', 'hero.trailer': '▶ Guarda il trailer',
    'f.title': 'Uno sparatutto vero, in tasca', 'f.lead': 'Pensato per il touch dal primo fotogramma, messo a punto sullo schermo del Seeker.',
    'f1.t': 'Attacco e difesa', 'f1.d': 'Gli attaccanti piazzano una carica sull\'obiettivo, i difensori resistono o la disinnescano. I rinforzi tornano a ondate ogni pochi secondi.',
    'f2.t': 'Cinque classi', 'f2.d': 'Soldato, Medico, Geniere, Operatore e Incursore: rianima la squadra, piazza più in fretta, porta più granate.',
    'f3.t': 'Online su ogni mappa', 'f3.d': 'Server autoritativi, partita rapida e una classifica settimanale calcolata dal server.',
    'f4.t': 'Voce di squadra', 'f4.d': 'Premi per parlare, solo con la tua squadra. Il microfono è attivo solo mentre tieni PARLA; non viene registrato nulla.',
    'f5.t': '50 livelli, sfide ogni giorno', 'f5.d': 'Gradi, sfide giornaliere e settimanali, finiture del fucile e colori del punto. Le ricompense sono solo estetiche.',
    'f6.t': '17 lingue', 'f6.d': 'Tutte le lingue del Solana dApp Store, con un tutorial di un minuto e l\'aiuto alla mira regolabile.',
    't.title': 'Trailer', 't.lead': 'Registrato su un Seeker.',
    'm.title': 'Quattro mappe', 'm.lead': 'Da un terminal container a un vero quartiere portuale ricostruito da OpenStreetMap.',
    'm1.t': 'Banchina Est', 'm1.d': 'Pile di container e un bunker di controllo delle gru sul bordo del porto.',
    'm2.t': 'Magazzini del Sale', 'm2.d': 'Tre corsie in un quartiere di magazzini fino a un cortile di carico murato.',
    'm3.t': 'Scalo Ferroviario', 'm3.d': 'Lunghe linee di tiro lungo i binari, scontri negli incroci tra i vagoni.',
    'm4.t': 'Trieste — Porto Vecchio', 'm4.d': 'Il porto vecchio di Trieste, ricostruito dai dati di OpenStreetMap.',
    'p.title': 'Gratis ogni giorno. Senza limiti con il Daily Pass.',
    'p.1': 'Una partita gratuita contro i bot ogni giorno, senza wallet.',
    'p.2': 'Il Daily Pass apre partite senza limiti e il gioco online per un giorno.',
    'p.3': 'Si attiva nel gioco dal wallet del Seeker: 0,01 SOL per 1 giorno. Il wallet ti mostra ogni richiesta prima che tu la approvi.',
    'p.4': 'I depositi di rete tornano nel tuo wallet quando il pass finisce.',
    'p.note': 'Il Daily Pass è un accesso al gioco, non un investimento: non promette alcun rendimento. Tutti i dettagli sono nel gioco e nei Termini.',
    'q.title': 'Domande frequenti',
    'q1.q': 'Su quali dispositivi funziona?', 'q1.a': 'SEEK &amp; STRIKE è pensato per il Solana Seeker e funziona sui telefoni Android recenti. È distribuito tramite il Solana dApp Store.',
    'q2.q': 'Posso giocare offline?', 'q2.a': 'Sì: ogni mappa si gioca offline contro i bot. Una partita al giorno è gratuita; il Daily Pass apre partite senza limiti e l\'online.',
    'q3.q': 'Come funziona la classifica?', 'q3.a': 'Il server assegna i punti di ogni round online: 100 per abbattimento, 300 per vittoria e 50 per round giocato. Si azzera ogni settimana (settimana ISO, UTC).',
    'q4.q': 'La voce viene registrata?', 'q4.a': 'No. Il microfono si apre solo mentre tieni PARLA e la tua voce arriva in tempo reale solo ai compagni di squadra. Non viene salvato nulla.',
    'q5.q': 'Il gioco è open source?', 'q5.a': 'Sì, con licenza GPL-3.0-or-later. Il codice è su <a href="https://github.com/mikeminer/seekandstrike">GitHub</a>.',
    'd.title': 'Presto sul Solana dApp Store', 'd.lead': 'Apri il dApp Store sul tuo Seeker e cerca SEEK &amp; STRIKE.',
    'ft.privacy': 'Privacy', 'ft.terms': 'Termini', 'ft.source': 'Codice sorgente',
    'ft.osm': 'Dati della mappa Trieste — Porto Vecchio © OpenStreetMap contributors (ODbL). Non affiliato a Solana Mobile.',
  },
};
// English strings are taken from the page itself on first load, so switching back restores them.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-i]').forEach(function (el) { window.SS_I18N.en[el.getAttribute('data-i')] = el.innerHTML; });
}, { once: true });
