import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  CreditCard,
  ExternalLink,
  Gift,
  LogOut,
  RefreshCw,
  Ticket,
  UserCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Card, CommitInput, Empty, Field, Segmented } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import { api } from '../lib/ipc';
import { useStore } from '../lib/store';
import type { AccountInfo, PayMethod, ShopState } from '../lib/types';

/** How long to keep asking the service whether a payment landed. */
const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 3000;

export function AccountView() {
  const { t } = useI18n();
  const toastError = useStore((s) => s.toastError);

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const current = await api.accountInfo();
        setInfo(current);
        setShop(current.linked ? await api.accountState() : null);
      } catch (error) {
        // A failed refresh must not blank a screen the user is reading; the
        // toast says what went wrong and the previous figures stay put.
        toastError(error);
      } finally {
        setLoading(false);
      }
    },
    [toastError],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  if (loading && !info) return null;

  if (!info?.linked) {
    return <LinkPanel onLinked={() => void refresh(true)} />;
  }

  return (
    <div className="stack stack--lg">
      <div className="view-header">
        <div>
          <h1 className="view-title">{t('account.title')}</h1>
          <p className="view-subtitle">{t('account.subtitle')}</p>
        </div>

        <div className="row">
          <button className="btn" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            {t('account.refresh')}
          </button>
          <button
            className="btn btn--ghost"
            onClick={async () => {
              try {
                await api.accountUnlink();
                await refresh(true);
              } catch (error) {
                toastError(error);
              }
            }}
          >
            <LogOut size={15} />
            {t('account.unlink')}
          </button>
        </div>
      </div>

      {shop && (
        <>
          <QuotaCard shop={shop} />
          <ShopCard shop={shop} onPurchased={() => void refresh()} />
          <ReferralCard shop={shop} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Pairing: the user brings a code from the bot, we exchange it for a token. */
function LinkPanel({ onLinked }: { onLinked: () => void }) {
  const { t } = useI18n();
  const toastError = useStore((s) => s.toastError);
  const toast = useStore((s) => s.toast);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.accountLink(code);
      toast('success', t('account.linked'));
      onLinked();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack--lg">
      <div className="view-header">
        <div>
          <h1 className="view-title">{t('account.title')}</h1>
          <p className="view-subtitle">{t('account.linkSubtitle')}</p>
        </div>
      </div>

      <Empty
        icon={<UserCheck size={22} />}
        title={t('account.linkTitle')}
        hint={t('account.linkHint')}
        action={
          <div className="stack" style={{ gap: 10, width: 280 }}>
            <input
              className="input"
              value={code}
              placeholder="XXXX-XXXX"
              autoFocus
              style={{ textAlign: 'center', letterSpacing: 2, textTransform: 'uppercase' }}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim()) void submit();
              }}
            />
            <button
              className="btn btn--primary"
              onClick={submit}
              disabled={busy || code.trim().length < 4}
            >
              {busy ? t('account.linking') : t('account.linkAction')}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void openUrl('https://t.me/')}
            >
              <ExternalLink size={13} />
              {t('account.openBot')}
            </button>
          </div>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuotaCard({ shop }: { shop: ShopState }) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const sub = shop.subscription;
  const ratio = sub.unlimited ? 0 : Math.min(100, sub.percent) / 100;
  const tone = ratio > 0.9 ? 'bad' : ratio > 0.75 ? 'warn' : 'ok';

  return (
    <Card title={t('account.quota')}>
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <span className="metric__value" style={{ fontSize: 26 }}>
          {sub.unlimited ? t('account.unlimited') : t('home.trafficLeft', { left: sub.left_h })}
        </span>
        {!sub.unlimited && (
          <span className="field__hint">
            {t('nodes.usage', { used: sub.used_h, total: sub.limit_h })}
          </span>
        )}
      </div>

      {!sub.unlimited && (
        <span className="meter" style={{ marginBottom: 12 }}>
          <span
            className={`meter__fill${tone === 'ok' ? '' : ` meter__fill--${tone}`}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </span>
      )}

      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span className="muted">{t('account.periodEnd', { date: sub.period_end })}</span>
        <span className="muted">{t('account.freeMonthly', { gb: sub.free_gb })}</span>
        {sub.extra > 0 && (
          <span className="chip chip--ok">{t('account.extra', { amount: sub.extra_h })}</span>
        )}
      </div>

      {sub.url && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn btn--sm"
            onClick={async () => {
              await writeText(sub.url!);
              toast('success', t('nodes.copied'));
            }}
          >
            {t('account.copySubscription')}
          </button>
          <span className="field__hint">{t('account.subscriptionHint')}</span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ShopCard({ shop, onPurchased }: { shop: ShopState; onPurchased: () => void }) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const toastError = useStore((s) => s.toastError);

  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState('');
  const [method, setMethod] = useState<PayMethod>('yookassa');
  const [quote, setQuote] = useState<{ price: number; percent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const pack = shop.packs.find((p) => p.code === selected) ?? null;

  // Re-price whenever the pack or the code changes, so the button always shows
  // what will actually be charged.
  useEffect(() => {
    if (!pack) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    api
      .accountQuote(pack.code, promo.trim() || undefined)
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [pack, promo]);

  /** Ask the service, at intervals, whether the payment has been credited. */
  const awaitPayment = async (orderId: number | string) => {
    setWaiting(true);
    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const result = await api.accountCheck(orderId);
          if (result.paid || result.credited) {
            toast('success', t('account.credited'));
            onPurchased();
            return;
          }
        } catch {
          // "Not paid yet" comes back as an error while the user is still on
          // the payment page; only a verdict ends the wait.
        }
      }
      toast('info', t('account.stillPending'));
    } finally {
      setWaiting(false);
    }
  };

  const buy = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const result = await api.accountBuy(pack.code, method, promo.trim() || undefined);
      if (result.free) {
        toast('success', t('account.credited'));
        onPurchased();
        return;
      }
      if (!result.url) throw new Error(t('account.noPaymentUrl'));

      // Payment happens in the browser, with the bank or wallet — never here.
      await openUrl(result.url);
      toast('info', t('account.payInBrowser'));
      void awaitPayment(result.order_id);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('account.shop')}>
      <div className="stack" style={{ gap: 6 }}>
        {shop.packs.map((p) => (
          <label
            key={p.code}
            className={`node${selected === p.code ? ' node--active' : ''}`}
            style={{ gridTemplateColumns: 'auto 1fr auto', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="pack"
              checked={selected === p.code}
              onChange={() => setSelected(p.code)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="node__body">
              <span className="node__name">{t('account.packGb', { gb: p.gb })}</span>
              <span className="node__meta">
                {t('account.packBonus', { gb: p.bonus_gb })}
              </span>
            </span>
            <span className="node__latency">{p.price} ₽</span>
          </label>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <Field label={t('account.promo')}>
          <CommitInput
            value={promo}
            placeholder={t('account.promoPlaceholder')}
            ariaLabel={t('account.promo')}
            onCommit={setPromo}
          />
        </Field>

        {shop.cryptobot && (
          <Field label={t('account.method')}>
            <Segmented<PayMethod>
              value={method}
              onChange={setMethod}
              options={[
                { value: 'yookassa', label: t('account.methodCard') },
                { value: 'cryptobot', label: t('account.methodCrypto') },
              ]}
            />
          </Field>
        )}
      </div>

      <div className="row row--between" style={{ marginTop: 12 }}>
        <span className="field__hint">
          {quote?.percent
            ? t('account.promoApplied', { percent: quote.percent })
            : t('account.payHint')}
        </span>
        <button
          className="btn btn--primary"
          onClick={buy}
          disabled={!pack || busy || waiting}
        >
          {waiting ? (
            <>
              <RefreshCw size={15} className="spin" />
              {t('account.awaitingPayment')}
            </>
          ) : (
            <>
              {quote?.percent ? <Ticket size={15} /> : <CreditCard size={15} />}
              {pack
                ? t('account.payAction', { price: quote?.price ?? pack.price })
                : t('account.pickPack')}
            </>
          )}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ReferralCard({ shop }: { shop: ShopState }) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const ref = shop.referral;

  return (
    <Card title={t('account.referral')}>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        {t('account.referralHint', { percent: ref.percent, gb: ref.welcome_gb })}
      </p>

      <div className="metrics">
        <div className="metric">
          <div className="metric__label">
            <Gift size={13} />
            {t('account.invited')}
          </div>
          <div className="metric__value">{ref.invited}</div>
        </div>
        <div className="metric">
          <div className="metric__label">{t('account.refPurchases')}</div>
          <div className="metric__value">{ref.purchases}</div>
        </div>
        <div className="metric">
          <div className="metric__label">{t('account.refEarned')}</div>
          <div className="metric__value metric__value--down">{ref.earned_gb} ГБ</div>
        </div>
      </div>

      {ref.link && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn btn--sm"
            onClick={async () => {
              await writeText(ref.link!);
              toast('success', t('nodes.copied'));
            }}
          >
            {t('account.copyReferral')}
          </button>
          <span className="field__hint">{ref.link}</span>
        </div>
      )}
    </Card>
  );
}
