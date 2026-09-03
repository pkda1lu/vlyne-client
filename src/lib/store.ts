/** Global UI state, kept in step with the backend through events. */

import { useMemo } from 'react';
import { create } from 'zustand';

import { api, asIpcError, EVENT, on } from './ipc';
import { locales, translate } from '../locales';
import type { AppData, LogLine, Settings, Status, Traffic } from './types';

/** Seconds of throughput history kept for the sparkline. */
const HISTORY_LENGTH = 60;

export interface Sample {
  up: number;
  down: number;
}

interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface State {
  ready: boolean;
  data: AppData | null;
  status: Status | null;
  traffic: Traffic;
  history: Sample[];
  logs: LogLine[];
  appVersion: string;
  coreVersion: string;
  /** Node the core is really using; differs from the selection in auto mode. */
  activeOutboundId: string | null;
  busy: boolean;
  toasts: Toast[];

  init: () => Promise<void>;
  toast: (kind: Toast['kind'], text: string) => void;
  /** Show a backend error using the current language. */
  toastError: (error: unknown) => void;
  dismissToast: (id: number) => void;

  connect: (nodeId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  toggle: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  ready: false,
  data: null,
  status: null,
  traffic: { up: 0, down: 0, totalUp: 0, totalDown: 0 },
  history: Array.from({ length: HISTORY_LENGTH }, () => ({ up: 0, down: 0 })),
  logs: [],
  appVersion: '',
  coreVersion: '',
  activeOutboundId: null,
  busy: false,
  toasts: [],

  async init() {
    const boot = await api.bootstrap();
    set({
      ready: true,
      data: boot.data,
      status: boot.status,
      traffic: boot.traffic,
      logs: boot.logs,
      appVersion: boot.appVersion,
      coreVersion: boot.coreVersion,
    });

    await on(EVENT.data, (data) => set({ data }));
    await on(EVENT.status, (status) => {
      set({ status });
      // The core picks the node itself in automatic mode, so re-read it
      // whenever the connection state changes.
      if (status.state === 'connected') {
        api
          .activeOutboundNode()
          .then((id) => set({ activeOutboundId: id }))
          .catch(() => set({ activeOutboundId: null }));
      } else {
        set({ activeOutboundId: null });
      }
    });

    await on(EVENT.traffic, (traffic) => {
      set((s) => ({
        traffic,
        history: [...s.history.slice(1), { up: traffic.up, down: traffic.down }],
      }));
    });

    await on(EVENT.log, (lines) => {
      set((s) => ({ logs: [...s.logs, ...lines].slice(-400) }));
    });
  },

  toast(kind, text) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // Errors stay long enough to be read and copied; the rest are transient.
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 3200);
  },

  toastError(error) {
    const { code, message } = asIpcError(error);
    const language = get().data?.settings.general.language === 'en' ? 'en' : 'ru';
    const localised = translate(locales[language], `errors.${code}`);

    // An unmapped code falls through to the raw message, which is still more
    // useful than a generic apology.
    const text =
      localised === `errors.${code}` ? message : `${localised}: ${message}`;
    get().toast('error', text);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async connect(nodeId) {
    set({ busy: true });
    try {
      await api.connect(nodeId);
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ busy: false });
    }
  },

  async disconnect() {
    set({ busy: true });
    try {
      await api.disconnect();
    } catch (error) {
      get().toastError(error);
    } finally {
      set({ busy: false });
    }
  },

  async toggle() {
    const state = get().status?.state;
    if (state === 'connected' || state === 'connecting') {
      await get().disconnect();
    } else {
      await get().connect();
    }
  },

  async saveSettings(settings) {
    try {
      const needsRestart = await api.saveSettings(settings);
      if (needsRestart) {
        // Applying in place would leave the core running an older config than
        // the one the UI is showing, so reconnect rather than drift.
        const lang = get().data?.settings.general.language === 'en' ? 'en' : 'ru';
        get().toast('info', translate(locales[lang], 'settings.reconnecting'));
        await api.disconnect();
        await api.connect();
      }
    } catch (error) {
      get().toastError(error);
    }
  },
}));

/** Nodes grouped by the subscription they came from. */
export function useGroupedNodes() {
  const data = useStore((s) => s.data);

  return useMemo(() => {
    if (!data) return [];

    const groups = data.subscriptions.map((subscription) => ({
      subscription,
      nodes: data.nodes.filter((n) => n.subscriptionId === subscription.id),
    }));

    const manual = data.nodes.filter((n) => !n.subscriptionId);
    return manual.length > 0
      ? [...groups, { subscription: null, nodes: manual }]
      : groups;
  }, [data]);
}
