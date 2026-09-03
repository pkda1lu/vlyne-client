/** Typed wrappers around the Tauri command surface. */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AccountInfo,
  AppData,
  BuyResult,
  CheckResult,
  PayMethod,
  ShopState,
  Bootstrap,
  IpcError,
  LogLine,
  Node,
  Settings,
  Status,
  Subscription,
  Traffic,
  TunnelMode,
} from './types';

export const EVENT = {
  status: 'vlyne://status',
  traffic: 'vlyne://traffic',
  log: 'vlyne://log',
  data: 'vlyne://data',
  latency: 'vlyne://latency',
} as const;

/**
 * Anything thrown across IPC arrives as `{ code, message }`. Normalising it
 * here means callers can always rely on both fields being present.
 */
export function asIpcError(error: unknown): IpcError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as IpcError;
  }
  return { code: 'unknown', message: String(error) };
}

export const api = {
  bootstrap: () => invoke<Bootstrap>('bootstrap'),
  getStatus: () => invoke<Status>('get_status'),

  connect: (nodeId?: string) => invoke<void>('connect', { nodeId: nodeId ?? null }),
  disconnect: () => invoke<void>('disconnect'),
  selectNode: (nodeId: string) => invoke<void>('select_node', { nodeId }),
  selectAuto: () => invoke<void>('select_auto'),
  activeOutboundNode: () => invoke<string | null>('active_outbound_node'),

  testLatency: (nodeIds?: string[]) =>
    invoke<void>('test_latency', { nodeIds: nodeIds ?? null }),

  importLinks: (text: string) => invoke<number>('import_links', { text }),
  updateNode: (node: Node) => invoke<void>('update_node', { node }),
  deleteNodes: (nodeIds: string[]) => invoke<void>('delete_nodes', { nodeIds }),
  exportNodeLink: (nodeId: string) => invoke<string>('export_node_link', { nodeId }),

  addSubscription: (url: string, name?: string) =>
    invoke<string>('add_subscription', { url, name: name ?? null }),
  refreshSubscription: (id: string) => invoke<number>('refresh_subscription', { id }),
  updateSubscription: (subscription: Subscription) =>
    invoke<void>('update_subscription', { subscription }),
  deleteSubscription: (id: string, keepNodes: boolean) =>
    invoke<void>('delete_subscription', { id, keepNodes }),

  /** Resolves to `true` when the running core must be restarted to apply. */
  saveSettings: (settings: Settings) => invoke<boolean>('save_settings', { settings }),
  /** Resolves to `true` when the app must be relaunched as administrator. */
  setMode: (mode: TunnelMode) => invoke<boolean>('set_mode', { mode }),
  restartElevated: () => invoke<void>('restart_elevated'),

  accountInfo: () => invoke<AccountInfo>('account_info'),
  accountLink: (code: string) => invoke<AccountInfo>('account_link', { code }),
  accountUnlink: () => invoke<void>('account_unlink'),
  accountSetApiBase: (base: string) => invoke<void>('account_set_api_base', { base }),
  accountState: () => invoke<ShopState>('account_state'),
  accountQuote: (pack: string, promo?: string) =>
    invoke<{ price: number; percent: number }>('account_quote', { pack, promo: promo ?? null }),
  accountBuy: (pack: string, method: PayMethod, promo?: string) =>
    invoke<BuyResult>('account_buy', { pack, method, promo: promo ?? null }),
  accountCheck: (orderId: number | string) =>
    invoke<CheckResult>('account_check', { orderId }),

  getLogs: () => invoke<LogLine[]>('get_logs'),
  clearLogs: () => invoke<void>('clear_logs'),
  previewConfig: () => invoke<string>('preview_config'),
  checkConnectivity: () => invoke<string>('check_connectivity'),
  openDataFolder: () => invoke<void>('open_data_folder'),
};

type EventMap = {
  [EVENT.status]: Status;
  [EVENT.traffic]: Traffic;
  [EVENT.log]: LogLine[];
  [EVENT.data]: AppData;
  [EVENT.latency]: [string, number | null][];
};

export function on<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(event as string, (e) => handler(e.payload));
}
