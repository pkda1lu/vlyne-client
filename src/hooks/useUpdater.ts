import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { useCallback, useEffect, useState } from 'react';

import { useStore } from '../lib/store';

export interface UpdateState {
  available: Update | null;
  downloading: boolean;
  /** 0 to 1, or `null` when the server did not report a content length. */
  progress: number | null;
  install: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Checks for an update once at startup, when the setting allows it.
 *
 * A failed check is deliberately silent: it usually means the machine is
 * offline or the tunnel is down, neither of which is worth a error toast on
 * every launch.
 */
export function useUpdater(): UpdateState {
  const enabled = useStore((s) => s.data?.settings.general.checkUpdates ?? true);
  const ready = useStore((s) => s.ready);
  const toastError = useStore((s) => s.toastError);

  const [available, setAvailable] = useState<Update | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !enabled) return;

    let cancelled = false;
    check()
      .then((update) => {
        if (!cancelled) setAvailable(update);
      })
      .catch(() => {
        /* offline or unreachable: not worth interrupting the user */
      });

    return () => {
      cancelled = true;
    };
  }, [ready, enabled]);

  const install = useCallback(async () => {
    if (!available) return;
    setDownloading(true);

    try {
      let total = 0;
      let received = 0;

      await available.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setProgress(total > 0 ? 0 : null);
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total > 0) setProgress(received / total);
        }
      });

      await relaunch();
    } catch (error) {
      toastError(error);
      setDownloading(false);
      setProgress(null);
    }
  }, [available, toastError]);

  return {
    available,
    downloading,
    progress,
    install,
    dismiss: () => setAvailable(null),
  };
}
