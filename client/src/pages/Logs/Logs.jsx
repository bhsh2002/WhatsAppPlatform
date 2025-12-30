import React, { useState, useEffect } from 'react';
import { FileText, Filter, RefreshCw, ArrowUpRight, ArrowDownLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../../api';

const Logs = () => {
    const [activeTab, setActiveTab] = useState('messages'); // messages, webhooks
    const [messages, setMessages] = useState([]);
    const [webhookLogs, setWebhookLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState({ direction: '', status: '' });

    const fetchMessages = async () => {
        try {
            setLoading(true);
            const params = {};
            if (filter.direction) params.direction = filter.direction;
            const data = await api.getMessageLogs(params);
            setMessages(data.messages || []);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchWebhookLogs = async () => {
        try {
            setLoading(true);
            const data = await api.getWebhookLogs(50);
            setWebhookLogs(data);
        } catch (error) {
            console.error('Failed to fetch webhook logs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'messages') {
            fetchMessages();
        } else {
            fetchWebhookLogs();
        }
    }, [activeTab, filter]);

    const getStatusIcon = (status) => {
        switch (status) {
            case 'sent':
            case 'delivered':
            case 'read':
                return <CheckCircle2 size={16} style={{ color: 'hsl(var(--color-success))' }} />;
            case 'failed':
                return <AlertCircle size={16} style={{ color: 'hsl(var(--color-destructive))' }} />;
            default:
                return <AlertCircle size={16} style={{ color: 'hsl(var(--color-warning))' }} />;
        }
    };

    const getDirectionIcon = (direction) => {
        if (direction === 'incoming') {
            return <ArrowDownLeft size={16} style={{ color: 'hsl(var(--color-accent))' }} />;
        }
        return <ArrowUpRight size={16} style={{ color: 'hsl(var(--color-success))' }} />;
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleString('ar-SA', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>سجلات التشغيل</h1>
                    <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>عرض جميع الرسائل وأحداث الـ Webhook.</p>
                </div>
                <button
                    className="button button-secondary"
                    onClick={() => activeTab === 'messages' ? fetchMessages() : fetchWebhookLogs()}
                    disabled={loading}
                    style={{ gap: '0.5rem' }}
                >
                    <RefreshCw size={18} className={loading ? 'spinning' : ''} />
                    تحديث
                </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                    className={`button ${activeTab === 'messages' ? 'button-primary' : 'button-secondary'}`}
                    onClick={() => setActiveTab('messages')}
                    style={{ flex: 1 }}
                >
                    <FileText size={18} />
                    الرسائل
                </button>
                <button
                    className={`button ${activeTab === 'webhooks' ? 'button-primary' : 'button-secondary'}`}
                    onClick={() => setActiveTab('webhooks')}
                    style={{ flex: 1 }}
                >
                    <Filter size={18} />
                    Webhook Events
                </button>
            </div>

            {/* Filters (for messages) */}
            {activeTab === 'messages' && (
                <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '1rem' }}>
                    <select
                        value={filter.direction}
                        onChange={(e) => setFilter({ ...filter, direction: e.target.value })}
                        style={{ width: '200px' }}
                    >
                        <option value="">كل الاتجاهات</option>
                        <option value="incoming">واردة</option>
                        <option value="outgoing">صادرة</option>
                    </select>
                </div>
            )}

            {/* Content */}
            <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        جاري التحميل...
                    </div>
                ) : activeTab === 'messages' ? (
                    messages.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--color-muted-foreground))' }}>
                            لا توجد رسائل
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: 'hsl(var(--color-secondary) / 0.5)' }}>
                                <tr style={{ textAlign: 'right' }}>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الاتجاه</th>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الرقم</th>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>النوع</th>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>المحتوى</th>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الحالة</th>
                                    <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الوقت</th>
                                </tr>
                            </thead>
                            <tbody>
                                {messages.map((msg) => (
                                    <tr key={msg.id} style={{ borderBottom: '1px solid hsl(var(--color-secondary))' }}>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {getDirectionIcon(msg.direction)}
                                                {msg.direction === 'incoming' ? 'واردة' : 'صادرة'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', fontFamily: 'monospace' }}>
                                            {msg.direction === 'incoming' ? msg.sender : msg.recipient}
                                        </td>
                                        <td style={{ padding: '1rem' }}>{msg.message_type}</td>
                                        <td style={{ padding: '1rem', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {msg.content}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {getStatusIcon(msg.status)}
                                                {msg.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', fontSize: '0.85rem', color: 'hsl(var(--color-muted-foreground))' }}>
                                            {formatDate(msg.created_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    webhookLogs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--color-muted-foreground))' }}>
                            لا توجد أحداث Webhook
                        </div>
                    ) : (
                        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {webhookLogs.map((log) => (
                                <div
                                    key={log.id}
                                    style={{
                                        background: 'hsl(var(--color-secondary) / 0.3)',
                                        padding: '1rem',
                                        borderRadius: 'var(--radius)',
                                        fontFamily: 'monospace',
                                        fontSize: '0.85rem'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <span style={{ color: 'hsl(var(--color-accent))' }}>{log.event_type}</span>
                                        <span style={{ color: 'hsl(var(--color-muted-foreground))' }}>{formatDate(log.created_at)}</span>
                                    </div>
                                    <pre style={{
                                        margin: 0,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                        maxHeight: '150px',
                                        overflow: 'auto',
                                        color: 'hsl(var(--color-foreground) / 0.8)'
                                    }}>
                                        {JSON.stringify(JSON.parse(log.payload || '{}'), null, 2)}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default Logs;
