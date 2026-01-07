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
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '12px',
                width: '90%',
                maxWidth: '500px',
                padding: '24px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Link size={24} />
                        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>
                            {inputType === 'subscription' ? t.addSubscription : t.addServer}
                        </h2>
                    </div>
                    <button onClick={onClose} style={{ padding: '4px', color: 'var(--text-secondary)' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Main Input */}
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
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
                                padding: '12px',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmit();
                            }}
                        />
                    </div>

                    {/* Name Input (only for subscriptions) */}
                    {inputType === 'subscription' && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                                {t.subscriptionName}
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t.addSubscription}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    backgroundColor: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    color: 'var(--text-primary)',
                                    fontSize: '14px',
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSubmit();
                                }}
                            />
                        </div>
                    )}

                    {/* Detection Info */}
                    {input.trim() && (
                        <div style={{
                            padding: '12px',
                            backgroundColor: 'var(--bg-primary)',
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: 'var(--text-secondary)',
                        }}>
                            {inputType === 'subscription' ? t.detectedSubscription : t.detectedServer}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '12px',
                            backgroundColor: 'rgba(255, 59, 48, 0.1)',
                            border: '1px solid rgba(255, 59, 48, 0.3)',
                            borderRadius: '8px',
                            color: '#ff3b30',
                            fontSize: '13px',
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: '12px',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                            }}
                        >
                            {t.cancel}
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !input.trim()}
                            style={{
                                flex: 1,
                                padding: '12px',
                                backgroundColor: loading || !input.trim() ? '#555' : 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                fontWeight: 500,
                                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {loading ? t.adding : t.add}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
