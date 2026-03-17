import { useState, useEffect } from 'react';
import { X, Link } from 'lucide-react';
import { useTranslation } from '../contexts/I18nContext';

interface UnifiedAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddServer: (link: string) => void;
    onAddSubscription: (url: string, name: string) => Promise<void>;
}

export function UnifiedAddModal({ isOpen, onClose, onAddServer, onAddSubscription }: UnifiedAddModalProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setInput('');
            setName('');
            setError('');
            setLoading(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const isSubscriptionUrl = (text: string): boolean => {
        // Check if it's an HTTP(S) URL (subscription)
        return text.trim().startsWith('http://') || text.trim().startsWith('https://');
    };

    const handleSubmit = async () => {
        if (!input.trim()) {
            setError(t.enterLinkOrUrl);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const trimmedInput = input.trim();

            if (isSubscriptionUrl(trimmedInput)) {
                // It's a subscription URL
                await onAddSubscription(trimmedInput, name.trim() || t.addSubscription);
            } else {
                // It's a single server configuration
                onAddServer(trimmedInput);
            }

            setInput('');
            setName('');
            onClose();
        } catch (err: any) {
            setError(err.message || t.failedToFetch);
        } finally {
            setLoading(false);
        }
    };

    const inputType = isSubscriptionUrl(input) ? 'subscription' : 'server';

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
            zIndex: 1000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '32px',
                width: '90%',
                maxWidth: '550px',
                padding: '40px',
                boxShadow: '0 40px 100px rgba(0, 0, 0, 0.6)',
                position: 'relative',
                overflow: 'hidden'
            }}>
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

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ padding: '12px', borderRadius: '14px', backgroundColor: 'rgba(255,255,255,0.03)', color: 'var(--accent-color)' }}>
                            <Link size={24} />
                        </div>
                        <h2 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px' }}>
                            {inputType === 'subscription' ? t.addSubscription : t.addServer}
                        </h2>
                    </div>
                    <button onClick={onClose} style={{ 
                        padding: '10px', 
                        color: 'var(--text-secondary)',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color)',
                        transition: 'all 0.2s'
                    }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}>
                        <X size={24} />
                    </button>
                </div>

                {/* Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative', zIndex: 1 }}>
                    {/* Main Input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {inputType === 'subscription' ? t.subscriptionUrl : t.configurationLink}
                        </label>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                setInput(newValue);

                                // Auto-extract name from URL hash
                                if (isSubscriptionUrl(newValue) && !name) {
                                    try {
                                        const urlObj = new URL(newValue);
                                        if (urlObj.hash.length > 1) {
                                            setName(decodeURIComponent(urlObj.hash.substring(1)));
                                        }
                                    } catch (e) {
                                        // Ignore invalid URLs
                                    }
                                }
                            }}
                            placeholder={inputType === 'subscription' ? t.placeholderUrl : t.placeholderLink}
                            style={{
                                width: '100%',
                                padding: '16px',
                                backgroundColor: 'rgba(255,255,255,0.02)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '14px',
                                color: 'var(--text-primary)',
                                fontSize: '15px',
                                fontWeight: 600,
                                outline: 'none',
                                transition: 'all 0.2s',
                            }}
                            className="premium-input"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmit();
                            }}
                        />
                    </div>

                    {/* Name Input (only for subscriptions) */}
                    {inputType === 'subscription' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {t.subscriptionName}
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t.addSubscription}
                                style={{
                                    width: '100%',
                                    padding: '16px',
                                    backgroundColor: 'rgba(255,255,255,0.02)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '14px',
                                    color: 'var(--text-primary)',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    outline: 'none',
                                    transition: 'all 0.2s',
                                }}
                                className="premium-input"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSubmit();
                                }}
                            />
                        </div>
                    )}

                    {/* Detection Info */}
                    {input.trim() && (
                        <div style={{
                            padding: '12px 16px',
                            backgroundColor: 'rgba(0, 255, 163, 0.05)',
                            borderRadius: '12px',
                            fontSize: '13px',
                            color: 'var(--accent-color)',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            border: '1px solid rgba(0, 255, 163, 0.1)'
                        }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />
                            {inputType === 'subscription' ? t.detectedSubscription : t.detectedServer}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '14px 16px',
                            backgroundColor: 'rgba(255, 77, 77, 0.1)',
                            borderRadius: '12px',
                            color: 'var(--danger-color)',
                            fontSize: '13px',
                            fontWeight: 600,
                            border: '1px solid rgba(255, 77, 77, 0.2)'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: '16px',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '16px',
                                color: 'var(--text-secondary)',
                                fontWeight: 700,
                                fontSize: '15px',
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            {t.cancel}
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !input.trim()}
                            style={{
                                flex: 1.5,
                                padding: '16px',
                                backgroundColor: loading || !input.trim() ? 'rgba(255,255,255,0.05)' : 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '16px',
                                color: loading || !input.trim() ? 'var(--text-secondary)' : '#000',
                                fontWeight: 800,
                                fontSize: '15px',
                                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                                transition: 'all 0.3s',
                                boxShadow: loading || !input.trim() ? 'none' : '0 10px 25px var(--accent-glow)'
                            }}
                            onMouseEnter={(e) => {
                                if (!loading && input.trim()) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 15px 30px var(--accent-glow)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!loading && input.trim()) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 10px 25px var(--accent-glow)';
                                }
                            }}
                        >
                            {loading ? t.adding : t.add}
                        </button>
                    </div>
                </div>
            </div>
            <style>{`
                .premium-input:focus {
                    border-color: var(--accent-color) !important;
                    background-color: rgba(255,255,255,0.05) !important;
                }
            `}</style>
        </div>
    );
}
