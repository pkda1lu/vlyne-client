import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, CheckCircle } from 'lucide-react';
import { useTranslation } from '../contexts/I18nContext';

interface UpdateInfo {
    version: string;
    releaseDate: string;
    releaseNotes?: string;
}

interface UpdateModalProps {
    forcedInfo?: UpdateInfo | null;
    onCloseForced?: () => void;
}

export function UpdateModal({ forcedInfo, onCloseForced }: UpdateModalProps) {
    const { t } = useTranslation();
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
            setError(t.downloadStartError);
            setIsDownloading(false);
        }
    };

    const handleInstall = async () => {
        try {
            await window.electronAPI.installUpdate();
        } catch (err: any) {
            console.error('Failed to install:', err);
            setError(t.installError);
        }
    };

    const handleClose = () => {
        setUpdateInfo(null);
        onCloseForced && onCloseForced();
    };

    useEffect(() => {
        if (forcedInfo) {
            setUpdateInfo(forcedInfo);
        }
    }, [forcedInfo]);

    if (!updateInfo) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '32px',
                width: '450px',
                padding: '40px',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                boxShadow: '0 40px 100px rgba(0, 0, 0, 0.6)',
                position: 'relative',
                overflow: 'hidden'
            }} className="float-animation">
                {/* Background Glow */}
                <div style={{ 
                    position: 'absolute', 
                    top: '-50px', 
                    right: '-50px', 
                    width: '300px', 
                    height: '300px', 
                    background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
                    zIndex: 0,
                    pointerEvents: 'none'
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '12px', borderRadius: '14px', backgroundColor: 'rgba(0, 255, 163, 0.1)', color: 'var(--accent-color)' }}>
                            <RefreshCw size={24} className={isDownloading ? 'spin-animation' : ''} />
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px' }}>
                            {t.updateAvailable}
                        </h2>
                    </div>
                    {!isDownloading && (
                        <button
                            onClick={handleClose}
                            style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '12px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '8px',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                <div style={{ color: 'var(--text-primary)', fontSize: '15px', lineHeight: '1.6', position: 'relative', zIndex: 1 }}>
                    <div style={{ marginBottom: '16px', fontWeight: 800, fontSize: '17px' }}>
                        {t.newVersionAvailable.replace('{{version}}', updateInfo.version)}
                    </div>
                    
                    {/* Release Notes */}
                    <div style={{ 
                        backgroundColor: 'rgba(255,255,255,0.02)', 
                        borderRadius: '20px', 
                        padding: '20px', 
                        marginBottom: '24px',
                        border: '1px solid var(--border-color)',
                        maxHeight: '150px',
                        overflowY: 'auto'
                    }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                            Что нового:
                        </div>
                        <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <li>Полный редизайн интерфейса в стиле Glassmorphism</li>
                            <li>Улучшенная стабильность VLESS и Reality протоколов</li>
                            <li>Автоматическое переключение на быстрые узлы</li>
                            <li>Исправлены ошибки при импорте больших подписок</li>
                            <li>Оптимизация потребления ресурсов в фоновом режиме</li>
                        </ul>
                    </div>

                    {isReadyToInstall ? (
                        <div style={{ 
                            color: 'var(--accent-color)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px',
                            padding: '16px',
                            backgroundColor: 'rgba(0, 255, 163, 0.05)',
                            borderRadius: '16px',
                            border: '1px solid rgba(0, 255, 163, 0.1)',
                            fontWeight: 700
                        }}>
                            <CheckCircle size={20} />
                            {t.updateReadyToInstall}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {t.updateQuestion}
                        </div>
                    )}
                </div>

                {isDownloading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>{t.downloading}...</span>
                            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-color)' }}>{Math.round(progress)}%</span>
                        </div>
                        <div style={{
                            height: '10px',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            borderRadius: '5px',
                            overflow: 'hidden',
                            border: '1px solid var(--border-color)'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${progress}%`,
                                background: 'linear-gradient(90deg, var(--accent-color) 0%, #00d4ff 100%)',
                                transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: '0 0 10px var(--accent-glow)'
                            }} />
                        </div>
                    </div>
                )}

                {error && (
                    <div style={{ 
                        color: 'var(--danger-color)', 
                        fontSize: '13px', 
                        fontWeight: 600,
                        padding: '12px',
                        backgroundColor: 'rgba(255, 77, 77, 0.1)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 77, 77, 0.2)',
                        position: 'relative', 
                        zIndex: 1
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end', position: 'relative', zIndex: 1, marginTop: '8px' }}>
                    {!isDownloading && !isReadyToInstall && (
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '14px 24px',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '16px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: 700,
                                fontSize: '14px',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {t.later}
                        </button>
                    )}

                    {isReadyToInstall ? (
                        <button
                            onClick={handleInstall}
                            style={{
                                flex: 1,
                                padding: '16px 24px',
                                backgroundColor: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '16px',
                                color: '#000',
                                cursor: 'pointer',
                                fontWeight: 800,
                                fontSize: '15px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                transition: 'all 0.3s',
                                boxShadow: '0 10px 25px var(--accent-glow)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 15px 30px var(--accent-glow)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 10px 25px var(--accent-glow)';
                            }}
                        >
                            <RefreshCw size={18} />
                            {t.restartAndUpdate}
                        </button>
                    ) : (
                        <button
                            onClick={handleDownload}
                            disabled={isDownloading}
                            style={{
                                flex: isDownloading ? 1 : undefined,
                                padding: '16px 32px',
                                backgroundColor: isDownloading ? 'rgba(255,255,255,0.05)' : 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '16px',
                                color: isDownloading ? 'var(--text-secondary)' : '#000',
                                cursor: isDownloading ? 'wait' : 'pointer',
                                fontWeight: 800,
                                fontSize: '15px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                transition: 'all 0.3s',
                                boxShadow: isDownloading ? 'none' : '0 10px 25px var(--accent-glow)'
                            }}
                            onMouseEnter={(e) => {
                                if (!isDownloading) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 15px 30px var(--accent-glow)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isDownloading) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 10px 25px var(--accent-glow)';
                                }
                            }}
                        >
                            {isDownloading ? (
                                <>{t.downloading}...</>
                            ) : (
                                <>
                                    <Download size={18} />
                                    {t.update}
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin-animation {
                    animation: spin 2s linear infinite;
                }
                .float-animation {
                    animation: float 6s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
