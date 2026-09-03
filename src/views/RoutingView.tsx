import { Plus, Trash2 } from 'lucide-react';

import { Card, CommitInput, Field, Switch } from '../components/ui';
import { useI18n } from '../hooks/useI18n';
import { useStore } from '../lib/store';
import type { RoutingPreset, RoutingRule, RuleKind, RuleTarget, Settings } from '../lib/types';

const PRESETS: RoutingPreset[] = ['global', 'bypass-lan', 'bypass-ru', 'custom'];

const PRESET_KEY: Record<RoutingPreset, string> = {
  global: 'Global',
  'bypass-lan': 'BypassLan',
  'bypass-ru': 'BypassRu',
  custom: 'Custom',
};

const KINDS: RuleKind[] = [
  'domainSuffix',
  'domain',
  'domainKeyword',
  'domainRegex',
  'ipCidr',
  'port',
  'processName',
];

const TARGETS: RuleTarget[] = ['proxy', 'direct', 'block'];

export function RoutingView() {
  const { t } = useI18n();
  const settings = useStore((s) => s.data?.settings);
  const save = useStore((s) => s.saveSettings);

  if (!settings) return null;

  /**
   * Apply a change to a copy and persist it.
   *
   * The base is re-read from the store rather than taken from this render, so
   * two edits made before the first save echoes back cannot clobber each other.
   */
  const patch = (mutate: (draft: Settings) => void) => {
    const current = useStore.getState().data?.settings ?? settings;
    const draft: Settings = structuredClone(current);
    mutate(draft);
    void save(draft);
  };

  const rules = settings.routing.rules;

  return (
    <div className="stack stack--lg">
      <div className="view-header">
        <div>
          <h1 className="view-title">{t('routing.title')}</h1>
          <p className="view-subtitle">{t('routing.subtitle')}</p>
        </div>
      </div>

      <Card title={t('routing.preset')}>
        <div className="stack" style={{ gap: 6 }}>
          {PRESETS.map((preset) => (
            <label
              key={preset}
              className={`node${settings.routing.preset === preset ? ' node--active' : ''}`}
              style={{ gridTemplateColumns: 'auto 1fr', cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="preset"
                checked={settings.routing.preset === preset}
                onChange={() => patch((d) => (d.routing.preset = preset))}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="node__body">
                <span className="node__name">{t(`routing.preset${PRESET_KEY[preset]}`)}</span>
                <span className="node__meta">{t(`routing.preset${PRESET_KEY[preset]}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <Switch
          label={t('routing.blockAds')}
          hint={t('routing.blockAdsHint')}
          checked={settings.routing.blockAds}
          onChange={(v) => patch((d) => (d.routing.blockAds = v))}
        />
        <Switch
          label={t('routing.blockQuic')}
          hint={t('routing.blockQuicHint')}
          checked={settings.routing.blockQuicForDirect}
          onChange={(v) => patch((d) => (d.routing.blockQuicForDirect = v))}
        />
      </Card>

      <Card
        title={t('routing.rules')}
        action={
          <button
            className="btn btn--sm"
            onClick={() =>
              patch((d) =>
                d.routing.rules.push({
                  id: crypto.randomUUID(),
                  kind: 'domainSuffix',
                  value: '',
                  target: 'proxy',
                  enabled: true,
                }),
              )
            }
          >
            <Plus size={13} />
            {t('routing.addRule')}
          </button>
        }
      >
        <p className="field__hint" style={{ marginBottom: 12 }}>
          {t('routing.rulesHint')}
        </p>

        {rules.length === 0 ? (
          <p className="muted">{t('routing.noRules')}</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onChange={(next) => patch((d) => (d.routing.rules[index] = next))}
                onRemove={() => patch((d) => d.routing.rules.splice(index, 1))}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title={t('routing.bypassProcesses')}>
        <Field label={t('routing.bypassProcesses')} hint={t('routing.bypassProcessesHint')}>
          <CommitInput
            value={settings.routing.bypassProcesses.join(', ')}
            placeholder="steam.exe, discord.exe"
            ariaLabel={t('routing.bypassProcesses')}
            onCommit={(value) =>
              patch(
                (d) =>
                  (d.routing.bypassProcesses = value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)),
              )
            }
          />
        </Field>
      </Card>
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: RoutingRule;
  onChange: (rule: RoutingRule) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="row" style={{ gap: 8 }}>
      <select
        className="select"
        style={{ width: 190 }}
        value={rule.kind}
        onChange={(e) => onChange({ ...rule, kind: e.target.value as RuleKind })}
      >
        {KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`routing.kind.${kind}`)}
          </option>
        ))}
      </select>

      <CommitInput
        style={{ flex: 1 }}
        value={rule.value}
        placeholder={t('routing.ruleValue')}
        ariaLabel={t('routing.ruleValue')}
        onCommit={(value) => onChange({ ...rule, value })}
      />

      <select
        className="select"
        style={{ width: 160 }}
        value={rule.target}
        onChange={(e) => onChange({ ...rule, target: e.target.value as RuleTarget })}
      >
        {TARGETS.map((target) => (
          <option key={target} value={target}>
            {t(`routing.target.${target}`)}
          </option>
        ))}
      </select>

      <button className="btn btn--ghost btn--icon" onClick={onRemove} aria-label="Remove">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
