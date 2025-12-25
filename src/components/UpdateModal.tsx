import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, CheckCircle } from 'lucide-react';

interface UpdateInfo {
    version: string;
    releaseDate: string;
    releaseNotes?: string;
}

export function UpdateModal() {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [isReadyToInstall, setIsReadyToInstall] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!window.electronAPI) return;

        const cleanupAvailable = window.electronAPI.onUpdateAvailable((info: any) => {
            console.log('Update available:', info);
            setUpdateInfo(info);
            // Reset states when new update appears
            setIsDownloading(false);
            setProgress(0);
            setIsReadyToInstall(false);
            setError(null);
        });

        const cleanupProgress = window.electronAPI.onDownloadProgress((prog: any) => {
            setIsDownloading(true);
            setProgress(prog.percent);
        });

        const cleanupDownloaded = window.electronAPI.onUpdateDownloaded(() => {
            setIsDownloading(false);
            setProgress(100);
            setIsReadyToInstall(true);
        });

        return () => {
            cleanupAvailable && cleanupAvailable();
            cleanupProgress && cleanupProgress();
            cleanupDownloaded && cleanupDownloaded();
        };
    }, []);

    const handleDownload = async () => {
        try {
            setError(null);
            setIsDownloading(true);
            await window.electronAPI.downloadUpdate();
        } catch (err: any) {
            console.error('Failed to start download:', err);
            setError('Failed to start download');
            setIsDownloading(false);
        }
    };

    const handleInstall = async () => {
        try {
            await window.electronAPI.installUpdate();
        } catch (err: any) {
            console.error('Failed to install:', err);
            setError('Failed to install update');
        }
    };

    const handleClose = () => {
        // We only allow closing if not strictly enforcing update, 
        // but for now user can close to ignore it until next restart
        setUpdateInfo(null);
    };

    if (!updateInfo) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '16px',
                width: '400px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                border: '1px solid var(--border-color)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <RefreshCw size={24} style={{ color: 'var(--accent-color)' }} />
                        Доступно обновление
                    </h2>
                    {!isDownloading && (
                        <button
                            onClick={handleClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer'
                            }}
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                <div style={{ color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.5' }}>
                    <div style={{ marginBottom: '8px' }}>
                        Новая версия <strong>{updateInfo.version}</strong> доступна для скачивания.
                    </div>
                    {isReadyToInstall ? (
                        <div style={{ color: 'var(--success-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle size={16} />
                            Обновление загружено и готово к установке.
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-secondary)' }}>
                            Хотите обновить приложение сейчас?
                        </div>
                    )}
                </div>

                {isDownloading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{
                            height: '6px',
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '3px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${progress}%`,
                                backgroundColor: 'var(--accent-color)',
                                transition: 'width 0.2s ease'
                            }} />
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
                            {Math.round(progress)}%
                        </div>
                    </div>
                )}

                {error && (
                    <div style={{ color: '#ff3b30', fontSize: '13px' }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    {!isDownloading && !isReadyToInstall && (
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: 500
                            }}
                        >
                            Позже
                        </button>
                    )}

                    {isReadyToInstall ? (
                        <button
                            onClick={handleInstall}
                            style={{
                                flex: 1,
                                padding: '10px 20px',
                                backgroundColor: 'var(--success-color)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <RefreshCw size={18} />
                            Перезапустить и обновить
                        </button>
                    ) : (
                        <button
                            onClick={handleDownload}
                            disabled={isDownloading}
                            style={{
                                flex: isDownloading ? 1 : undefined,
                                padding: '10px 20px',
                                backgroundColor: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                cursor: isDownloading ? 'wait' : 'pointer',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                opacity: isDownloading ? 0.8 : 1
                            }}
                        >
                            {isDownloading ? (
                                <>Скачивание...</>
                            ) : (
                                <>
                                    <Download size={18} />
                                    Обновить
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
