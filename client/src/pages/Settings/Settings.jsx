import React, { useState, useEffect } from 'react';
import { Key, Webhook, CheckCircle, XCircle, Copy, RefreshCw } from 'lucide-react';
import api from '../../api';

const Settings = () => {
    const [config, setConfig] = useState({
        phoneNumberId: localStorage.getItem('ab_wa_phoneId') || '',
        accessToken: localStorage.getItem('ab_wa_token') || '',
        webhookVerifyToken: 'whatsapp_platform_verify_token_2024',
    });
    const [serverStatus, setServerStatus] = useState(null); // null, 'checking', 'online', 'offline'
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);

    // Get webhook URL based on current server
    const getWebhookUrl = () => {
        // In production, this would be your domain
        return `${api.baseUrl}/webhook`;
    };

    const checkServerStatus = async () => {
        setServerStatus('checking');
        try {
            await api.checkHealth();
            setServerStatus('online');
        } catch (error) {
            setServerStatus('offline');
        }
    };

    useEffect(() => {
        checkServerStatus();
    }, []);

    const handleSave = () => {
        localStorage.setItem('ab_wa_phoneId', config.phoneNumberId);
        localStorage.setItem('ab_wa_token', config.accessToken);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const copyWebhookUrl = async () => {
        try {
            await navigator.clipboard.writeText(getWebhookUrl());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    const StatusIndicator = () => {
        if (serverStatus === 'checking') {
            return <span style={{ color: 'hsl(var(--color-muted-foreground))' }}>جاري الفحص...</span>;
        }
        if (serverStatus === 'online') {
            return (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--color-success))' }}>
                    <CheckCircle size={18} />
                    متصل
                </span>
            );
        }
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--color-destructive))' }}>
                <XCircle size={18} />
                غير متصل
            </span>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px' }}>
            <div>
                <h1>الإعدادات</h1>
                <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>إعدادات الربط مع واتساب و Meta Cloud API.</p>
            </div>

            {/* Server Status Card */}
            <div className="card glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <RefreshCw size={20} />
                        حالة الخادم
                    </h3>
                    <button className="button button-secondary" onClick={checkServerStatus} style={{ padding: '0.5rem' }}>
                        <RefreshCw size={16} />
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <StatusIndicator />
                    <span style={{ color: 'hsl(var(--color-muted-foreground))', fontSize: '0.875rem' }}>
                        {serverStatus === 'online' ? 'الخادم متصل ويعمل بشكل صحيح' : 'تأكد من تشغيل الخادم'}
                    </span>
                </div>
            </div>

            {/* Webhook Configuration Card */}
            <div className="card glass-panel">
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Webhook size={20} />
                    إعدادات Webhook
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            Webhook URL
                            <span style={{ color: 'hsl(var(--color-muted-foreground))', fontSize: '0.8rem', marginRight: '0.5rem' }}>
                                (انسخه إلى Meta Dashboard)
                            </span>
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={getWebhookUrl()}
                                readOnly
                                style={{ flex: 1, background: 'hsl(var(--color-secondary) / 0.3)' }}
                            />
                            <button
                                className="button button-secondary"
                                onClick={copyWebhookUrl}
                                style={{ padding: '0.75rem' }}
                            >
                                {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            Verify Token
                            <span style={{ color: 'hsl(var(--color-muted-foreground))', fontSize: '0.8rem', marginRight: '0.5rem' }}>
                                (للتحقق من الـ Webhook)
                            </span>
                        </label>
                        <input
                            type="text"
                            value={config.webhookVerifyToken}
                            readOnly
                            style={{ background: 'hsl(var(--color-secondary) / 0.3)' }}
                        />
                    </div>
                </div>

                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'hsl(var(--color-secondary) / 0.3)', borderRadius: 'var(--radius)' }}>
                    <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>كيفية الإعداد:</h4>
                    <ol style={{ fontSize: '0.85rem', color: 'hsl(var(--color-muted-foreground))', paddingRight: '1.2rem', margin: 0 }}>
                        <li>افتح Meta Developer Dashboard</li>
                        <li>اذهب إلى WhatsApp → Configuration</li>
                        <li>في قسم Webhook، اضغط Edit</li>
                        <li>الصق Webhook URL أعلاه</li>
                        <li>الصق Verify Token أعلاه</li>
                        <li>اختر الـ Subscriptions: messages, message_echoes</li>
                    </ol>
                </div>
            </div>

            {/* API Credentials Card */}
            <div className="card glass-panel">
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Key size={20} />
                    بيانات الربط (Meta Cloud API)
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            Phone Number ID
                        </label>
                        <input
                            type="text"
                            value={config.phoneNumberId}
                            onChange={(e) => setConfig({ ...config, phoneNumberId: e.target.value })}
                            placeholder="مثال: 105956789012345"
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            Access Token
                        </label>
                        <input
                            type="password"
                            value={config.accessToken}
                            onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
                            placeholder="EAA..."
                        />
                    </div>

                    <button
                        className="button"
                        onClick={handleSave}
                        style={{
                            background: saved ? 'hsl(var(--color-success))' : 'linear-gradient(135deg, hsl(var(--color-accent)), #4338ca)',
                            color: 'white',
                            marginTop: '0.5rem'
                        }}
                    >
                        {saved ? '✓ تم الحفظ' : 'حفظ البيانات'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Settings;
