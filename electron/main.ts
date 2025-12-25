import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { setSystemProxy, disableSystemProxy, restoreProxyFromBackup } from './proxy';
import { tcpPing } from './ping';
// import { pingServer } from './ping'; // Removed in favor of tcpPing
import { generateXrayConfig } from './xray-config-generator';
import https from 'https';
import http from 'http';
import { Store } from './store';
import { autoUpdater } from 'electron-updater';

// Configure autoUpdater log
autoUpdater.logger = console;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // Initialize Store
    const store = new Store({
        configName: 'user-preferences',
        defaults: {
            servers: [],
            subscriptions: [],
            activeServerId: null,
            settings: {
                general: {
                    autoConnect: false,
                    autoEnableProxy: true,
                    minimizeToTray: false,
                    language: 'en'
                },
                inbound: {
                    socksPort: 10806,
                    httpPort: 10810,
                    allowLan: false,
                    udpSupport: true,
                    sniffing: true
                },
                routing: {
                    mode: 'bypass-lan',
                    domainStrategy: 'IPIfNonMatch',
                    customRules: []
                },
                dns: {
                    primaryDns: '8.8.8.8',
                    fallbackDns: '1.1.1.1',
                    strategy: 'UseIP',
                    disableCache: false,
                    disableFallback: false
                },
                core: {
                    logLevel: 'warning',
                    accessLog: false,
                    errorLog: true,
                    enableStats: false
                },
                advanced: {
                    mux: {
                        enabled: false,
                        concurrency: 8
                    },
                    fragment: {
                        enabled: false,
                        packets: 'tlshello',
                        length: '100-200',
                        interval: '10-20'
                    },
                    maxConnections: 0,
                    connectionTimeout: 30
                }
            }
        }
    });

    let mainWindow: BrowserWindow | null = null;
    let tray: Tray | null = null;
    let isQuitting = false;

    const createTray = () => {
        if (tray) return;

        const devIconPath = path.join(__dirname, '../../public/logo.png');
        const prodIconPath = path.join(process.resourcesPath, 'logo.png');
        let trayIcon = nativeImage.createFromPath(process.env.NODE_ENV !== 'development' ? prodIconPath : devIconPath);

        // Attempt to use a system icon or simple workaround if explicit file missing
        if (trayIcon.isEmpty()) {
            // Debug: just log
            console.log('Tray icon is empty/missing, falling back to default electron icon');
            trayIcon = nativeImage.createFromPath('');
        }

        tray = new Tray(trayIcon);
        tray.setToolTip('Vlyne Client');

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show App',
                click: () => {
                    mainWindow?.show();
                }
            },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);

        tray.on('double-click', () => {
            mainWindow?.show();
        });
    };

    const createWindow = () => {
        // Create the browser window.
        mainWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
            autoHideMenuBar: true,
            frame: true,
            backgroundColor: '#1e1e1e',
            icon: process.env.NODE_ENV === 'development'
                ? path.join(__dirname, '../../public/logo.png')
                : path.join(process.resourcesPath, 'logo.png'),
        });

        // In production, load the index.html of the app.
        // In development, load the local server.
        if (process.env.NODE_ENV === 'development') {
            mainWindow.loadURL('http://localhost:5173');
            mainWindow.webContents.openDevTools();
        } else {
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
        }

        mainWindow.on('close', (event) => {
            const settings = store.get('settings');
            // If minimize to tray is enabled and we are not explicitly quitting
            if (!isQuitting && settings?.general?.minimizeToTray) {
                event.preventDefault();
                mainWindow?.hide();
                // Ensure tray exists
                if (!tray) createTray();
            }
            // Otherwise let it close
        });
    };

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    app.on('ready', async () => {
        await restoreProxyFromBackup().catch((err) => {
            console.error('Failed to restore proxy state on startup:', err);
        });
        createWindow();
        createTray();

        // Check for updates
        autoUpdater.checkForUpdatesAndNotify();
    });

    // Quit when all windows are closed, except on macOS.
    app.on('window-all-closed', () => {
        // If minimize to tray is enabled, we usually keep app running.
        // But 'window-all-closed' is emitted when all windows are destroyed.
        // If we intercepted 'close', the window is hidden, not closed.
        // So this event triggers only if we truly closed the window (e.g. isQuitting or minToTray disabled).
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    app.on('before-quit', (e) => {
        if (isQuitting && proxyCleanupDone) {
            return;
        }

        e.preventDefault();
        isQuitting = true;

        (async () => {
            if (xrayProcess) {
                try {
                    await killXrayProcess(xrayProcess);
                } catch (error) {
                    console.error('Failed to stop Xray on quit:', error);
                }
            }
            await handleXrayStopped('app-quit');
            app.exit(0);
        })();
    });

    // IPC Handlers
    let xrayProcess: ChildProcess | null = null;
    let proxyCleanupDone = false;
    let proxyCleanupInProgress = false;

    const killXrayProcess = async (proc: ChildProcess) => {
        if (!proc.pid) {
            proc.kill();
            return;
        }

        if (process.platform === 'win32') {
            await new Promise<void>((resolve, reject) => {
                const killer = spawn('taskkill', ['/pid', `${proc.pid}`, '/T', '/F']);
                killer.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`taskkill exited with code ${code}`));
                });
                killer.on('error', reject);
            });
        } else {
            proc.kill('SIGTERM');
        }
    };

    const handleXrayStopped = async (reason: string, extra?: Record<string, any>) => {
        if (proxyCleanupInProgress || proxyCleanupDone) return;
        proxyCleanupInProgress = true;
        try {
            await disableSystemProxy();
            proxyCleanupDone = true;
        } catch (error) {
            console.error('Failed to clean up system proxy:', error);
        } finally {
            proxyCleanupInProgress = false;
        }

        xrayProcess = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vpn-stopped', { reason, ...extra });
        }
    };

    const getHttpProxyPort = (settings: any) =>
        settings?.inbound?.httpPort ?? store.get('settings')?.inbound?.httpPort ?? 10809;
    const getSocksProxyPort = (settings: any) =>
        settings?.inbound?.socksPort ?? store.get('settings')?.inbound?.socksPort ?? 10808;

    // Storage IPC
    ipcMain.handle('get-store', (event, key) => {
        return store.get(key);
    });

    ipcMain.handle('set-store', (event, key, val) => {
        store.set(key, val);
    });

    ipcMain.handle('start-vpn', async (event, payload: any) => {
        // Support both old format (config directly) and new format ({ config, settings })
        const config = payload.server || payload;
        const settings = payload.settings || {};

        if (xrayProcess) {
            return { success: false, error: 'VPN already running' };
        }

        try {
            proxyCleanupDone = false;
            const isDev = process.env.NODE_ENV === 'development';
            const resourcesPath = isDev ? path.join(process.cwd(), 'resources/bin') : path.join(process.resourcesPath, 'bin');

            const xrayPath = path.join(resourcesPath, 'xray.exe');
            const configPath = path.join(resourcesPath, 'config.json');

            // Generate Xray configuration using the new modular generator
            const xrayConfig = generateXrayConfig(config, settings, resourcesPath);

            fs.writeFileSync(configPath, JSON.stringify(xrayConfig, null, 2));
            console.log('Generated Xray config:', JSON.stringify(xrayConfig, null, 2));

            xrayProcess = spawn(xrayPath, ['-c', configPath]);

            xrayProcess.stdout?.on('data', (data) => {
                console.log(`Xray: ${data}`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('xray-log', data.toString());
                }
            });

            xrayProcess.stderr?.on('data', (data) => {
                console.error(`Xray Error: ${data}`);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('xray-log', `[ERROR] ${data.toString()}`);
                }
            });

            xrayProcess.on('close', (code, signal) => {
                console.log(`Xray exited with code ${code} signal ${signal ?? 'none'}`);

                // Read error log if process exited unexpectedly
                if (code !== 0 && code !== null) {
                    try {
                        const errorLog = fs.readFileSync(path.join(resourcesPath, 'error.log'), 'utf8');
                        console.error('Xray error log:', errorLog);
                    } catch (e) {
                        console.error('Could not read error log:', e);
                    }
                }

                handleXrayStopped('process-exit', { code, signal });
            });

            // Set system proxy after Xray starts
            try {
                const httpPort = getHttpProxyPort(settings);
                await setSystemProxy('127.0.0.1', httpPort);
                console.log('System proxy configured');
            } catch (proxyError) {
                console.error('Failed to set system proxy:', proxyError);
                // Continue anyway, user can set manually
            }

            return { success: true };
        } catch (error: any) {
            console.error('Failed to start Xray:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-vpn', async () => {
        if (xrayProcess) {
            try {
                await killXrayProcess(xrayProcess);
            } catch (error) {
                console.error('Failed to stop Xray process:', error);
            }
            await handleXrayStopped('manual-stop');
            return { success: true };
        }
        await handleXrayStopped('manual-no-process');
        return { success: true, warning: 'VPN not running' };
    });


    // ... imports

    ipcMain.handle('ping-server', async (event, host: string, port: number) => {
        return await tcpPing(host, port);
    });

    ipcMain.handle('fetch-subscription', async (event, url: string) => {
        console.log('[Main] fetch-subscription called with:', url);
        return new Promise((resolve, reject) => {
            const isHttps = url.startsWith('https');
            const client = isHttps ? https : http;

            console.log('[Main] Using', isHttps ? 'HTTPS' : 'HTTP');

            const urlObj = new URL(url);
            const options: any = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
            };

            if (isHttps) {
                options.rejectUnauthorized = false; // Allow self-signed certificates
            }

            console.log('[Main] Request options:', options);

            const req = client.request(options, (res) => {
                console.log('[Main] Response status:', res.statusCode);
                console.log('[Main] Response headers:', JSON.stringify(res.headers, null, 2));
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                    console.log('[Main] Received chunk, total length:', data.length);
                });

                res.on('end', () => {
                    console.log('[Main] Request complete, total data length:', data.length);
                    console.log('[Main] Data preview:', data.substring(0, 100));

                    // Extract name from Content-Disposition header
                    let name = '';
                    const contentDisposition = res.headers['content-disposition'];
                    if (contentDisposition) {
                        // Try to match filename="name" or filename*=UTF-8''name
                        const filenameMatch = contentDisposition.match(/filename=['"]?([^'"]+)['"]?/i) ||
                            contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
                        if (filenameMatch) {
                            try {
                                name = decodeURIComponent(filenameMatch[1]);
                            } catch (e) {
                                name = filenameMatch[1];
                            }
                        }
                    }

                    // Also check for specific headers from some panels (like 3x-ui might send Profile-Title in future, or we just rely on filename)
                    if (!name && res.headers['profile-title']) {
                        name = res.headers['profile-title'] as string;
                    }

                    // Extract Subscription-Userinfo
                    // Format: upload=123; download=456; total=789; expire=1234567890
                    const userInfo = res.headers['subscription-userinfo'] as string || '';

                    resolve({ data, name, userInfo });
                });
            });

            req.on('error', (err) => {
                console.error('[Main] Request error:', err);
                reject(err);
            });

            req.end();
        });
    });
}
