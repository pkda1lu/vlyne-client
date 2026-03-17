import { useState, useEffect } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useTranslation } from '../contexts/I18nContext';

interface UpdateToastProps {
    onOpenModal: (info?: any) => void;
}

export function UpdateToast({ onOpenModal }: UpdateToastProps) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);

    useEffect(() => {
        if (!window.electronAPI) return;

        const cleanup = window.electronAPI.onUpdateAvailable((info: any) => {
            setUpdateInfo(info);
            // Slight delay for better entry animation
            setTimeout(() => setVisible(true), 1000);
        });

        return () => {
            cleanup && cleanup();
        };
    }, []);

    if (!updateInfo || !visible) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            zIndex: 2000,
            width: '350px',
            animation: 'slideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
            <div style={{
                backgroundColor: 'rgba(8, 10, 13, 0.95)',
                backdropFilter: 'blur(20px)',
                border: '1px solid var(--border-color)',
                borderRadius: '24px',
                padding: '24px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                position: 'relative',
                overflow: 'hidden'
            }} className="float-animation">
                {/* Background Glow */}
                <div style={{ 
                    position: 'absolute', 
                    top: '-20px', 
                    right: '-20px', 
                    width: '150px', 
                    height: '150px', 
                    background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
                    zIndex: 0,
                    pointerEvents: 'none'
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div style={{ 
                            padding: '10px', 
                            borderRadius: '14px', 
                            backgroundColor: 'rgba(0, 255, 163, 0.1)', 
                            color: 'var(--accent-color)' 
                        }}>
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
                                {t.updateAvailable}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--accent-color)', fontWeight: 700 }}>
                                v{updateInfo.version}
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={() => setVisible(false)}
                        style={{ color: 'var(--text-secondary)', padding: '4px' }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', position: 'relative', zIndex: 1 }}>
                    Мы обновили Vlyne! Новый интерфейс, улучшенная скорость и стабильность соединения.
                </div>

                <button
                    onClick={() => {
                        onOpenModal(updateInfo);
                        setVisible(false);
                    }}
                    style={{
                        backgroundColor: 'var(--accent-color)',
                        color: '#000',
                        padding: '12px 16px',
                        borderRadius: '14px',
                        fontSize: '13px',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: 'none',
                        position: 'relative',
                        zIndex: 1
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 10px 20px var(--accent-glow)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    {t.update}
                    <ArrowRight size={16} />
                </button>
            </div>

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%) scale(0.9); opacity: 0; }
                    to { transform: translateX(0) scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
