import { SLIPPAGE_OPTIONS_BPS, PASS_SECONDS } from '../constants';
import './pass.css';
import type { FlowError, FlowView, PassFlow, ReleaseOutcome, Review } from '../flow';
import type { VerifiedLock } from '../reader';
import type { WalletAdapter, WalletSession } from '../wallet';
import { loopbackState, onLoopbackChange, requestLoopback } from '../wallet/loopback';
import { pt, type PassKey } from './copy';
import { dt, DETAILS_ADDRESSES } from './details';
import { duration, localTime, pct, shortAddr, sol, utcTime } from './format';

/** A way to reach a wallet: the Seeker wallet (MWA), a browser wallet, or the DEV mock. */
export interface WalletChoice { label: string; kind: WalletAdapter['kind']; make: () => WalletAdapter }

export interface PanelDeps {
  flow: PassFlow;
  session: WalletSession;
  wallets: () => WalletChoice[];
  /** Called whenever the pass may have started or ended. */
  onGate: (open: boolean) => void;
}

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}
function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function errorText(e: FlowError): string {
  switch (e.kind) {
    case 'wallet': return pt(`w.${e.failure}` as PassKey);
    case 'rpc': return pt('e.rpc');
    case 'storage': return pt('e.storage');
    case 'ids-full': return pt('e.ids-full');
    case 'validation': return pt('e.validation', { reason: e.reason });
    case 'chain': {
      const f = e.failure;
      if (f.kind === 'program') return pt('c.program', { code: f.code ?? '?' });
      // Game-program errors 6000–6014 (the only other kind carrying a code).
      if ('code' in f) return pt(`f.${f.code}` as PassKey);
      return pt(`c.${f.kind}` as PassKey);
    }
  }
}

/** Renders the Daily Pass from PassFlow state. Text only through textContent (never injected HTML). */
export class PassPanel {
  readonly el = h('div', 'pass');
  private body = h('div', 'pass-body');
  private extra = h('div', 'pass-extra');
  private detailsOpen = false;
  private notice: string | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private tick: (() => void) | null = null;
  private releasing = new Map<string, string | 'busy'>();

  constructor(private readonly d: PanelDeps) {
    this.el.append(h('div', 'pass-title', pt('title')), this.body, this.extra);
    d.flow.onChange(() => this.render());
    onLoopbackChange(() => { this.notice = null; this.render(); });
    this.ticker = setInterval(() => this.tick?.(), 1000);
    this.render();
  }

  dispose(): void { if (this.ticker) clearInterval(this.ticker); }

  /** MWA on Android needs Chrome's local network access first; never open the wallet in that tap. */
  private loopbackReady(): boolean {
    if (this.d.session.adapter && this.d.session.adapter.kind !== 'mwa') return true;
    const s = loopbackState();
    if (s === 'prompt') { requestLoopback(); this.notice = pt('loopbackPrompt'); this.render(); return false; }
    if (s === 'denied') { this.notice = pt('w.LOOPBACK_DENIED'); this.render(); return false; }
    return true;
  }

  private render(): void {
    const v = this.d.flow.view;
    this.tick = null;
    this.d.onGate(this.d.flow.hasPass);
    this.body.replaceChildren(...this.screen(v));
    if (this.notice) this.body.append(h('p', 'pass-note', this.notice));
    this.extra.replaceChildren(...this.footer(v));
  }

  private header(): Node[] {
    const w = this.d.flow.wallet;
    if (!w) return [];
    return [h('div', 'pass-wallet', h('span', '', shortAddr(w)), btn(pt('disconnect'), () => void this.d.flow.disconnect(), 'pass-link'))];
  }

  private screen(v: FlowView): Node[] {
    const f = this.d.flow;
    switch (v.step) {
      case 'disconnected': return this.connectScreen();
      case 'connecting': return [h('p', 'pass-wait', pt('connecting'))];
      case 'loading': return [...this.header(), h('p', 'pass-wait', pt('loading'))];
      case 'checking': return [...this.header(), h('p', 'pass-wait', pt('checking'))];
      case 'preparing': return [...this.header(), h('p', 'pass-wait', pt('preparing'))];
      case 'wallet': return [...this.header(), h('p', 'pass-wait', pt('wallet')), h('p', 'pass-hint', pt('walletHint'))];
      case 'confirming': return [...this.header(), h('p', 'pass-wait', pt('confirmingTitle')), h('p', 'pass-hint', pt('confirmingHint'))];
      case 'unknown': return [...this.header(), h('p', 'pass-warn', pt('unknownTitle')), h('p', 'pass-hint', pt('unknownHint')),
        btn(pt('checkAgain'), () => void f.checkAgain())];
      case 'activate': return [...this.header(), h('p', 'pass-warn', pt('activateTitle')), h('p', 'pass-hint', pt('activateHint')),
        btn(pt('activate'), () => { if (this.loopbackReady()) void f.activate(); })];
      case 'active': return [...this.header(), ...this.activeScreen(v.status.expiresAt), ...this.endedList(v.expired)];
      case 'offer': return [...this.header(), ...this.offerScreen(v.partial, v.expired.length > 0),
        ...this.endedList(v.expired)];
      case 'review': return [...this.header(), ...this.reviewScreen(v.review)];
      case 'insufficient': return [...this.header(), h('p', 'pass-warn', pt('insufficient', { need: sol(v.needLamports), bal: sol(v.balance) })),
        btn(pt('back'), () => f.back('offer'))];
      case 'market': return [...this.header(), h('p', 'pass-warn', pt('market')), btn(pt('retry'), () => void f.startPurchase()), btn(pt('back'), () => f.back('offer'), 'pass-alt')];
      case 'route-unavailable': return [...this.header(), h('p', 'pass-warn', pt('routeUnavailable')), btn(pt('back'), () => f.back('offer'))];
      case 'error': return [...this.header(), h('p', 'pass-warn', pt('errTitle')), h('p', 'pass-err', errorText(v.error)),
        btn(pt('back'), () => f.back(v.back))];
    }
  }

  private connectScreen(): Node[] {
    const out: Node[] = [h('p', 'pass-offer', pt('offer')), h('p', 'pass-hint', pt('offerShort'))];
    const ws = this.d.wallets();
    if (!ws.length) { out.push(h('p', 'pass-warn', pt('noWalletDesktop'))); return out; }
    for (const w of ws) {
      out.push(btn(ws.length === 1 && w.kind === 'mwa' ? pt('connect') : pt('connectWith', { name: w.label }), () => {
        if (w.kind === 'mwa') {
          const s = loopbackState();
          if (s === 'prompt') { requestLoopback(); this.notice = pt('loopbackPrompt'); this.render(); return; }
          if (s === 'denied') { this.notice = pt('w.LOOPBACK_DENIED'); this.render(); return; }
        }
        this.notice = null;
        void this.d.flow.connect(w.make());
      }));
    }
    return out;
  }

  private activeScreen(expiresAt: number): Node[] {
    const left = h('div', 'pass-count');
    const upd = (): void => {
      const s = expiresAt - Math.floor(Date.now() / 1000);
      left.textContent = pt('endsIn', { time: duration(s) });
      if (s <= 0) { this.tick = null; void this.d.flow.refresh(); }
    };
    upd();
    this.tick = upd;
    return [
      h('div', 'pass-ok', pt('activeTitle')), left,
      h('p', 'pass-hint', pt('endsAt', { local: localTime(expiresAt), utc: utcTime(expiresAt) })),
      btn(pt('renew'), () => void this.d.flow.startPurchase(), 'pass-alt'),
    ];
  }

  private offerScreen(partial: boolean, ended: boolean): Node[] {
    const out: Node[] = [];
    if (ended) out.push(h('p', 'pass-hint', pt('offerExpired')));
    out.push(h('p', 'pass-offer', pt('offer')), h('p', 'pass-hint', pt('offerShort')));
    if (partial) out.push(h('p', 'pass-warn', pt('partial')));
    out.push(btn(pt('get'), () => void this.d.flow.startPurchase()));
    return out;
  }

  private reviewScreen(r: Review): Node[] {
    const f = this.d.flow;
    const row = (k: string, val: string, sub?: string): HTMLElement =>
      h('div', 'pass-row', h('span', '', k), h('b', '', val), sub ? h('small', '', sub) : null);
    const endS = Math.floor(Date.now() / 1000) + PASS_SECONDS;
    const endRow = row(pt('endTime'), localTime(endS), `${utcTime(endS)} UTC`);
    const age = h('small', 'pass-age');
    this.tick = () => {
      const e = Math.floor(Date.now() / 1000) + PASS_SECONDS;
      endRow.replaceChildren(h('span', '', pt('endTime')), h('b', '', localTime(e)), h('small', '', `${utcTime(e)} UTC`));
      age.textContent = pt('quoteAge', { s: Math.max(0, Math.round((Date.now() - r.quotedAt) / 1000)) });
    };
    this.tick();
    const c = r.costs;
    const firstTime = c.firstTimeRent + c.buybackRent + c.accumulatorRent;
    const lines = h('div', 'pass-break',
      h('div', 'pass-sub', pt('breakdown')),
      row(pt('swapPart'), `${sol(r.buffer.amountIn)} SOL`),
      row(pt('backLater'), `${sol(c.returned)} SOL`),
      firstTime > 0n ? row(pt('firstTime'), `${sol(firstTime)} SOL`) : null,
      c.firstTimeRent > 0n ? row(`· ${pt('accountSetup')}`, `${sol(c.firstTimeRent)} SOL`) : null,
      c.accumulatorRent > 0n ? row(`· ${pt('exchangeSetup')}`, `${sol(c.accumulatorRent)} SOL`) : null,
      c.buybackRent > 0n ? row(`· ${pt('sharedSetup')}`, `${sol(c.buybackRent)} SOL`) : null,
      row(pt('networkFee'), `${sol(r.feeLamports)} SOL`),
    );
    const tol = h('div', 'pass-tol', h('span', '', pt('tolerance')));
    for (const bps of SLIPPAGE_OPTIONS_BPS) {
      const b = btn(`${pct(bps)}%`, () => f.setSlippage(bps), bps === f.slippageBps ? 'pass-chip on' : 'pass-chip');
      tol.append(b);
    }
    if (!(SLIPPAGE_OPTIONS_BPS as readonly number[]).includes(f.slippageBps)) tol.append(h('span', 'pass-chip on', `${pct(f.slippageBps)}%`));
    return [
      h('div', 'pass-sub', pt('reviewTitle')),
      h('div', 'pass-total', h('span', '', pt('total')), h('b', '', `${sol(r.totalLamports)} SOL`)),
      endRow,
      r.retried ? h('p', 'pass-warn', pt('retried', { pct: pct(f.slippageBps) })) : null,
      r.mode === 'two' ? h('p', 'pass-hint', pt('twoRequests')) : null,
      tol, lines, age,
      btn(pt('confirm'), () => { if (this.loopbackReady()) void f.confirm(); }),
      btn(pt('cancel'), () => f.back('offer'), 'pass-alt'),
    ].filter((x): x is HTMLElement => !!x);
  }

  private endedList(list: VerifiedLock[]): Node[] {
    if (!list.length) return [];
    const box = h('div', 'pass-ended', h('div', 'pass-sub', pt('endedTitle')));
    for (const l of list) {
      const st = this.releasing.get(l.address);
      const item = h('div', 'pass-item', h('span', '', pt('endedItem', { date: localTime(Number(l.unlockAt)) })));
      if (st === 'busy') item.append(h('small', 'pass-wait', pt('wallet')));
      else {
        item.append(btn(pt('returnBtn'), () => void this.release(l), 'pass-alt'));
        if (st) item.append(h('small', 'pass-hint', st));
      }
      box.append(item);
    }
    box.append(h('p', 'pass-hint', pt('risk')));
    return [box];
  }

  private async release(l: VerifiedLock): Promise<void> {
    if (!this.loopbackReady()) return;
    this.releasing.set(l.address, 'busy');
    this.render();
    let out: ReleaseOutcome;
    try { out = await this.d.flow.release(l); } catch { out = { ok: false, reason: 'unknown' }; }
    const msg = out.ok ? pt('returnOk', { sol: sol(out.returnedLamports) })
      : out.reason === 'error' ? errorText(out.error)
      : out.reason === 'waiting' ? pt('returnWaiting')
      : out.reason === 'not-ended' ? pt('returnNotEnded')
      : out.reason === 'busy' ? pt('returnBusy') : pt('returnUnknown');
    this.releasing.set(l.address, msg);
    if (out.ok) await this.d.flow.refresh(); else this.render();
  }

  private footer(v: FlowView): Node[] {
    const frozen = v.step === 'wallet' || v.step === 'preparing' || v.step === 'confirming';
    const toggle = btn(this.detailsOpen ? pt('hideDetails') : pt('details'), () => { this.detailsOpen = !this.detailsOpen; this.render(); }, 'pass-link');
    toggle.disabled = frozen;
    const out: Node[] = [toggle];
    if (this.detailsOpen) out.push(this.detailsPanel());
    return out;
  }

  private detailsPanel(): HTMLElement {
    const addr = (label: string, value: string): HTMLElement => {
      const copy = btn(pt('copy'), () => {
        void navigator.clipboard?.writeText(value).then(() => { copy.textContent = pt('copied'); }, () => {});
      }, 'pass-chip');
      return h('div', 'pass-addr', h('span', '', label), h('code', '', value), copy);
    };
    return h('div', 'pass-details',
      h('p', '', dt('hold')),
      h('p', '', dt('fee')),
      h('p', 'pass-hint', pt('risk')),
      h('p', 'pass-hint', dt('route')),
      addr(dt('program'), DETAILS_ADDRESSES.program),
      addr(dt('mint'), DETAILS_ADDRESSES.mint),
      h('p', 'pass-hint', dt('network')),
    );
  }
}
