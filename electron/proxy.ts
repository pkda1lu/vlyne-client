import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ProxyState {
    enable: number;
    server?: string;
    override?: string;
}

const proxyBackupPath = path.join(app.getPath('userData'), 'proxy-backup.json');
let cachedBackup: ProxyState | null = null;

const escapeForPowerShell = (value: string | undefined) =>
    (value ?? '').replace(/'/g, "''");

async function readCurrentProxyState(): Promise<ProxyState> {
    const regPath = "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'";
    const command = [
        `$props = Get-ItemProperty -Path ${regPath}`,
        `$obj = @{ ProxyEnable = $props.ProxyEnable; ProxyServer = $props.ProxyServer; ProxyOverride = $props.ProxyOverride }`,
        '$obj | ConvertTo-Json -Compress'
    ].join('; ');

    const { stdout } = await execAsync(`powershell -NoProfile -Command "${command}"`);
    const parsed = JSON.parse(stdout.trim() || '{}');

    return {
        enable: Number(parsed.ProxyEnable) || 0,
        server: parsed.ProxyServer ?? '',
        override: parsed.ProxyOverride ?? '',
    };
}

async function loadBackup(): Promise<ProxyState | null> {
    if (cachedBackup) return cachedBackup;
    try {
        const raw = fs.readFileSync(proxyBackupPath, 'utf8');
        cachedBackup = JSON.parse(raw) as ProxyState;
        return cachedBackup;
    } catch {
        return null;
    }
}

async function saveBackup(state: ProxyState): Promise<void> {
    cachedBackup = state;
    fs.writeFileSync(proxyBackupPath, JSON.stringify(state));
}

async function clearBackup(): Promise<void> {
    cachedBackup = null;
    try {
        fs.unlinkSync(proxyBackupPath);
    } catch {
        // ignore if file does not exist
    }
}

async function applyProxyState(state: ProxyState): Promise<void> {
    const regPath = "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'";
    const parts: string[] = [
        `Set-ItemProperty -Path ${regPath} -Name ProxyEnable -Value ${state.enable ?? 0}`
    ];

    if (state.server !== undefined) {
        const server = escapeForPowerShell(state.server);
        if (server) {
            parts.push(`Set-ItemProperty -Path ${regPath} -Name ProxyServer -Value '${server}'`);
        } else {
            parts.push(`Remove-ItemProperty -Path ${regPath} -Name ProxyServer -ErrorAction SilentlyContinue`);
        }
    }

    if (state.override !== undefined) {
        const override = escapeForPowerShell(state.override);
        if (override) {
            parts.push(`Set-ItemProperty -Path ${regPath} -Name ProxyOverride -Value '${override}'`);
        } else {
            parts.push(`Remove-ItemProperty -Path ${regPath} -Name ProxyOverride -ErrorAction SilentlyContinue`);
        }
    }

    const cmd = parts.join('; ');
    await execAsync(`powershell -NoProfile -Command "${cmd}"`);
}

export async function setSystemProxy(host: string, port: number): Promise<void> {
    const proxyServer = `${host}:${port}`;

    try {
        // Save current state once so we can restore it even after app restarts.
        if (!(await loadBackup())) {
            const current = await readCurrentProxyState();
            await saveBackup(current);
        }

        await applyProxyState({
            enable: 1,
            server: proxyServer,
            override: '<local>', // common default to avoid proxying local resources
        });

        console.log(`System proxy set to ${proxyServer}`);
    } catch (error) {
        console.error('Failed to set system proxy:', error);
        throw error;
    }
}

export async function disableSystemProxy(): Promise<void> {
    try {
        const backup = await loadBackup();
        if (backup) {
            await applyProxyState(backup);
            await clearBackup();
            console.log('System proxy restored from backup');
        } else {
            await applyProxyState({ enable: 0, server: '', override: '' });
            console.log('System proxy disabled (no backup present)');
        }
    } catch (error) {
        console.error('Failed to disable system proxy:', error);
        throw error;
    }
}

export async function restoreProxyFromBackup(): Promise<void> {
    const backup = await loadBackup();
    if (!backup) return;
    await disableSystemProxy();
}
