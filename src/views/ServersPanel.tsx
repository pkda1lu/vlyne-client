import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  AlertTriangle,
  Copy,
  Gauge,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import { Confirm, Empty, Field, Modal, Segmented, Switch } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import {
  daysUntil,
  formatBytes,
  formatDate,
  formatRelative,
  guessRegion,
  latencyBand,
} from '../lib/format';
import { api } from '../lib/ipc';
import { useGroupedNodes, useStore } from '../lib/store';
import { isNodeUsable } from '../lib/types';
import type { Node, Subscription } from '../lib/types';

/**
 * Every configured server, as the left column of the connect view.
 *
 * The add dialog is opened from here and from the connect side, so whether
 * it is up lives with the parent rather than in this panel.
 */
export function ServersPanel({
  adding,
  onAddingChange,
}: {
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const groups = useGroupedNodes();
  const data = useStore((s) => s.data);
  const activeOutboundId = useStore((s) => s.activeOutboundId);
  const toast = useStore((s) => s.toast);
  const toastError = useStore((s) => s.toastError);

  // The persisted choice is the source of truth for what is selected: while
  // disconnected the status carries no node, and reading selection from it
  // made the list claim "automatic" even when a server had been picked.
  const selectedId = data?.activeNodeId ?? null;

  // While on automatic, show which server the core settled on.
  const autoNode =
    selectedId == null ? (data?.nodes.find((n) => n.id === activeOutboundId) ?? null) : null;

  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [keepNodes, setKeepNodes] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const nodeCount = data?.nodes.length ?? 0;

  const testAll = async () => {
    setTesting(true);
    try {
      await api.testLatency();
    } catch (error) {
      toastError(error);
    } finally {
      setTesting(false);
    }
  };

  const refresh = async (subscription: Subscription) => {
    setRefreshingId(subscription.id);
    try {
      const count = await api.refreshSubscription(subscription.id);
      toast('success', t('nodes.refreshed', { count }));
    } catch (error) {
      toastError(error);
    } finally {
      setRefreshingId(null);
    }
  };

  const select = async (node: Node) => {
    try {
      await api.selectNode(node.id);
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <div className="servers">
      <div className="servers__header">
        <div className="servers__heading">
          <h2 className="servers__title">{t('nodes.title')}</h2>
          <p className="servers__meta">
            {t('nodes.subtitle', { count: nodeCount, groups: groups.length })}
          </p>
        </div>

        <div className="row">
          <button
            className="btn btn--icon"
            onClick={testAll}
            disabled={testing || nodeCount === 0}
            title={testing ? t('nodes.testing') : t('nodes.testAll')}
            aria-label={t('nodes.testAll')}
          >
            <Gauge size={15} className={testing ? 'spin' : undefined} />
          </button>
          <button
            className="btn btn--primary btn--icon"
            onClick={() => onAddingChange(true)}
            title={t('nodes.add')}
            aria-label={t('nodes.add')}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="servers__list">
        {nodeCount > 0 && (
          <button
            className={`node${selectedId == null ? ' node--active' : ''}`}
            onClick={async () => {
              try {
                await api.selectAuto();
              } catch (error) {
                toastError(error);
              }
            }}
          >
            <span className="node__region">
              <Wand2 size={15} />
            </span>
            <span className="node__body">
              <span className="node__name">{t('nodes.auto')}</span>
              <span className="node__meta">{t('nodes.autoHint')}</span>
            </span>
            <span className="node__latency">
              {autoNode ? autoNode.name : t('nodes.untested')}
            </span>
            <span />
          </button>
        )}

        {nodeCount === 0 ? (
          <Empty
            icon={<Server size={22} />}
            title={t('nodes.empty')}
            hint={t('nodes.emptyHint')}
            action={
              <button className="btn btn--primary" onClick={() => onAddingChange(true)}>
                <Plus size={15} />
                {t('nodes.add')}
              </button>
            }
          />
        ) : (
          groups.map((group) => (
            <section className="group" key={group.subscription?.id ?? 'manual'}>
              <header className="group__header">
                <span className="group__name">
                  {group.subscription?.name ?? t('nodes.manual')}
                </span>
                <span className="group__meta">
                  {t('nodes.nodesCount', { count: group.nodes.length })}
                </span>

                {group.subscription && (
                  <SubscriptionMeta subscription={group.subscription} locale={locale} />
                )}

                {group.subscription && (
                  <div className="group__actions">
                    <button
                      className="btn btn--ghost btn--icon"
                      title={t('nodes.refresh')}
                      onClick={() => refresh(group.subscription!)}
                      disabled={refreshingId === group.subscription.id}
                    >
                      <RefreshCw
                        size={14}
                        className={refreshingId === group.subscription.id ? 'spin' : undefined}
                      />
                    </button>
                    <button
                      className="btn btn--ghost btn--icon"
                      title={t('nodes.deleteSubscription')}
                      onClick={() => {
                        setKeepNodes(false);
                        setPendingDelete(group.subscription);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </header>

              {group.nodes.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  selected={node.id === selectedId}
                  inUse={node.id === activeOutboundId}
                  onSelect={() => select(node)}
                />
              ))}
            </section>
          ))
        )}
      </div>

      {adding && <AddDialog onClose={() => onAddingChange(false)} />}

      {pendingDelete && (
        <Confirm
          title={t('nodes.deleteSubscription')}
          message={t('nodes.confirmDeleteSubscription', {
            name: pendingDelete.name,
            count: pendingDelete.nodeCount,
          })}
          confirmLabel={t('nodes.delete')}
          cancelLabel={t('common.cancel')}
          extra={
            <Switch
              label={t('nodes.keepNodes')}
              hint={t('nodes.keepNodesHint')}
              checked={keepNodes}
              onChange={setKeepNodes}
            />
          }
          onConfirm={() => {
            void api.deleteSubscription(pendingDelete.id, keepNodes);
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SubscriptionMeta({
  subscription,
  locale,
}: {
  subscription: Subscription;
  locale: string;
}) {
  const { t } = useI18n();
  const usage = subscription.usage;

  if (subscription.lastError) {
    return (
      <span className="chip chip--bad" title={subscription.lastError}>
        <AlertTriangle size={11} />
        {subscription.lastError.slice(0, 40)}
      </span>
    );
  }

  const used = usage ? usage.upload + usage.download : 0;
  const ratio = usage && usage.total > 0 ? used / usage.total : 0;
  const daysLeft = usage?.expire ? daysUntil(usage.expire) : null;

  return (
    <div className="row" style={{ gap: 10 }}>
      {usage && usage.total > 0 && (
        <span className="row" style={{ gap: 7 }}>
          <span className="meter" style={{ width: 70 }}>
            <span
              className={`meter__fill${ratio > 0.85 ? ' meter__fill--warn' : ''}`}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </span>
          <span className="group__meta">
            {t('nodes.usage', {
              used: formatBytes(used),
              total: formatBytes(usage.total),
            })}
          </span>
        </span>
      )}

      {daysLeft !== null && (
        <span className={`chip${daysLeft <= 0 ? ' chip--bad' : daysLeft < 7 ? ' chip--warn' : ''}`}>
          {daysLeft <= 0
            ? t('nodes.expired')
            : daysLeft < 30
              ? t('nodes.expiresIn', { days: daysLeft })
              : t('nodes.expires', { date: formatDate(usage!.expire, locale) })}
        </span>
      )}

      <span className="group__meta">
        {subscription.lastUpdatedAt
          ? t('nodes.updated', { when: formatRelative(subscription.lastUpdatedAt, locale) })
          : t('nodes.neverUpdated')}
      </span>
    </div>
  );
}

function NodeRow({
  node,
  selected,
  inUse,
  onSelect,
}: {
  node: Node;
  selected: boolean;
  inUse: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const toastError = useStore((s) => s.toastError);

  const unsupported = !isNodeUsable(node);
  const band = latencyBand(node.latencyMs);
  const region = guessRegion(node.name);

  const copy = async () => {
    try {
      await writeText(await api.exportNodeLink(node.id));
      toast('success', t('nodes.copied'));
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <div
      className={[
        'node',
        selected ? 'node--active' : '',
        unsupported ? 'node--unsupported' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onClick={unsupported ? undefined : onSelect}
      onKeyDown={(e) => {
        if (!unsupported && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      title={unsupported ? t('nodes.unsupported') : undefined}
    >
      <span className="node__region">{region ?? node.protocol.slice(0, 2).toUpperCase()}</span>

      <span className="node__body">
        <span className="node__name">
          {node.name}
          {/* Marks the node the core actually chose while on automatic. */}
          {inUse && !selected && (
            <span className="chip chip--accent" style={{ marginLeft: 8 }}>
              <Zap size={10} />
            </span>
          )}
        </span>
        <span className="node__meta">
          {node.protocol} · {node.server}:{node.serverPort}
          {node.tls.realityPublicKey ? ' · reality' : node.tls.enabled ? ' · tls' : ''}
          {node.transport.type !== 'tcp' ? ` · ${node.transport.type}` : ''}
        </span>
      </span>

      <span className={`node__latency node__latency--${band}`}>
        {node.latencyMs != null ? `${node.latencyMs} ms` : t('nodes.untested')}
      </span>

      <span className="node__actions">
        <button
          className="btn btn--ghost btn--icon"
          title={t('nodes.copyLink')}
          onClick={(e) => {
            e.stopPropagation();
            void copy();
          }}
        >
          <Copy size={14} />
        </button>
        <button
          className="btn btn--ghost btn--icon"
          title={t('nodes.delete')}
          onClick={(e) => {
            e.stopPropagation();
            void api.deleteNodes([node.id]);
          }}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useStore((s) => s.toast);
  const toastError = useStore((s) => s.toastError);

  const [tab, setTab] = useState<'links' | 'subscription'>('links');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (tab === 'links') {
        const count = await api.importLinks(text);
        toast('success', t('nodes.imported', { count }));
      } else {
        await api.addSubscription(url.trim(), name.trim() || undefined);
        toast('success', t('nodes.subscriptionAdded'));
      }
      onClose();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Route pasted text to the tab that can actually use it.
   *
   * A plain http(s) address is a subscription; anything carrying a protocol
   * scheme is one or more share links. Guessing here saves the user from
   * pasting into the wrong box and getting a parse error.
   */
  const paste = async () => {
    const clip = (await readText())?.trim();
    if (!clip) return;

    const isSubscription = /^https?:\/\//i.test(clip) && !clip.includes('\n');
    if (isSubscription) {
      setTab('subscription');
      setUrl(clip);
    } else {
      setTab('links');
      setText(clip);
    }
  };

  const canSubmit = tab === 'links' ? text.trim().length > 0 : url.trim().length > 0;

  return (
    <Modal
      title={t('nodes.add')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!canSubmit || busy}>
            {t('common.add')}
          </button>
        </>
      }
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'links', label: t('nodes.addLink') },
          { value: 'subscription', label: t('nodes.addSubscription') },
        ]}
      />

      {tab === 'links' ? (
        <Field label={t('nodes.addLink')} hint={t('nodes.addLinkHint')}>
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="vless://…"
            autoFocus
          />
        </Field>
      ) : (
        <>
          <Field label={t('nodes.subscriptionUrl')} hint={t('nodes.addSubscriptionHint')}>
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
            />
          </Field>
          <Field label={t('nodes.subscriptionName')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </>
      )}

      <button className="btn btn--sm" onClick={paste} style={{ alignSelf: 'flex-start' }}>
        <Copy size={13} />
        {t('nodes.fromClipboard')}
      </button>
    </Modal>
  );
}
