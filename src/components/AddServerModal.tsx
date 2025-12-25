import { useState } from 'react';
import { X } from 'lucide-react';

interface AddServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (link: string) => void;
}

export function AddServerModal({ isOpen, onClose, onAdd }: AddServerModalProps) {
    const [link, setLink] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!link.trim()) return;

        if (!link.startsWith('vless://')) {
            setError('Invalid VLESS link');
            return;
        }

        onAdd(link);
        setLink('');
        setError('');
        onClose();
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '12px',
                width: '400px',
                padding: '24px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.3)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Add Server</h2>
                    <button onClick={onClose} style={{ color: 'var(--text-secondary)' }}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                            VLESS Link
                        </label>
                        <textarea
                            value={link}
                            onChange={(e) => {
                                setLink(e.target.value);
                                setError('');
                            }}
                            placeholder="vless://..."
                            style={{
                                width: '100%',
                                height: '100px',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                padding: '12px',
                                color: 'var(--text-primary)',
                                resize: 'none',
                                fontFamily: 'monospace',
                                fontSize: '12px'
                            }}
                            autoFocus
                        />
                        {error && <div style={{ color: 'var(--danger-color)', fontSize: '12px', marginTop: '4px' }}>{error}</div>}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                backgroundColor: 'transparent'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            style={{
                                padding: '8px 20px',
                                borderRadius: '6px',
                                backgroundColor: 'var(--accent-color)',
                                color: '#fff',
                                fontWeight: 500
                            }}
                        >
                            Add
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
