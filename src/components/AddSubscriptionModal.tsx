import { useState } from 'react';
import { X, Link } from 'lucide-react';

interface AddSubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (url: string, name: string) => void;
}

export function AddSubscriptionModal({ isOpen, onClose, onAdd }: AddSubscriptionModalProps) {
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!url.trim()) {
            setError('Please enter a subscription URL');
            return;
        }

        setLoading(true);
        setError('');

        try {
            await onAdd(url.trim(), name.trim() || 'My Subscription');
            setUrl('');
            setName('');
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to fetch subscription');
        } finally {
            setLoading(false);
        }
    };

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
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Add Subscription</h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: '4px',
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        Subscription Name (optional)
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Subscription"
                        disabled={loading}
                        style={{
                            width: '100%',
                            padding: '12px',
                            backgroundColor: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                        }}
                    />
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                        Subscription URL
                    </label>
                    <div style={{ position: 'relative' }}>
                        <Link size={20} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://example.com/sub?token=..."
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '12px 12px 12px 40px',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                color: 'var(--text-primary)',
                                fontSize: '14px',
                            }}
                        />
                    </div>
                </div>

                {error && (
                    <div style={{
                        padding: '12px',
                        backgroundColor: 'rgba(255, 59, 48, 0.1)',
                        border: '1px solid rgba(255, 59, 48, 0.3)',
                        borderRadius: '8px',
                        color: '#ff3b30',
                        fontSize: '14px',
                        marginBottom: '16px',
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        style={{
                            flex: 1,
                            padding: '12px',
                            backgroundColor: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)',
                            fontWeight: 500,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.5 : 1,
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        style={{
                            flex: 1,
                            padding: '12px',
                            backgroundColor: 'var(--accent-color)',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            fontWeight: 500,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.5 : 1,
                        }}
                    >
                        {loading ? 'Fetching...' : 'Add Subscription'}
                    </button>
                </div>
            </div>
        </div>
    );
}
