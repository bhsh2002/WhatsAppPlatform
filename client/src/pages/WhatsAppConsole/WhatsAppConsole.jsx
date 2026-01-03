import React, { useState, useEffect } from 'react';
import { Send, Key, Smartphone, FileText, Plus, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../../api';
import { useTenants } from '../../context/TenantContext';

const WhatsAppConsole = () => {
    const { tenants } = useTenants();
    const [config, setConfig] = useState({
        token: localStorage.getItem('ab_wa_token') || '',
        phoneId: localStorage.getItem('ab_wa_phoneId') || '',
    });

    const [messageForm, setMessageForm] = useState({
        recipient: '',
        type: 'text',
        message: 'مرحباً! هذه رسالة تجريبية من لوحة التحكم ⚡',
        templateName: 'delivery_confirmation',
        templateLanguage: 'ar',
        templateParams: [],
        sendViaBackend: true, // New: toggle between backend and direct
        tenantId: '',
    });

    const [status, setStatus] = useState(null);
    const [logs, setLogs] = useState([]);
    const [serverOnline, setServerOnline] = useState(null);

    useEffect(() => {
        localStorage.setItem('ab_wa_token', config.token);
        localStorage.setItem('ab_wa_phoneId', config.phoneId);
    }, [config]);

    // Check server status
    useEffect(() => {
        const checkServer = async () => {
            try {
                await api.checkHealth();
                setServerOnline(true);
            } catch {
                setServerOnline(false);
            }
        };
        checkServer();
    }, []);

    const addParam = () => {
        setMessageForm(prev => {
            const components = [...(prev.templateParams || [])];
            let bodyComponentIndex = components.findIndex(c => c.type === 'body');

            if (bodyComponentIndex === -1) {
                components.push({ type: 'body', parameters: [{ type: 'text', text: '' }] });
            } else {
                components[bodyComponentIndex].parameters.push({ type: 'text', text: '' });
            }

            return { ...prev, templateParams: components };
        });
    };

    const updateParam = (paramIndex, value) => {
        setMessageForm(prev => {
            const components = [...prev.templateParams];
            const bodyIndex = components.findIndex(c => c.type === 'body');
            if (bodyIndex !== -1) {
                components[bodyIndex].parameters[paramIndex].text = value;
            }
            return { ...prev, templateParams: components };
        });
    };

    const removeParam = (paramIndex) => {
        setMessageForm(prev => {
            const components = [...prev.templateParams];
            const bodyIndex = components.findIndex(c => c.type === 'body');
            if (bodyIndex !== -1) {
                components[bodyIndex].parameters = components[bodyIndex].parameters.filter((_, i) => i !== paramIndex);
                if (components[bodyIndex].parameters.length === 0) {
                    components.splice(bodyIndex, 1);
                }
            }
            return { ...prev, templateParams: components };
        });
    };

    const handleSend = async (e) => {
        e.preventDefault();
        setStatus('loading');

        const timestamp = new Date().toLocaleTimeString();

        try {
            if (messageForm.sendViaBackend && serverOnline) {
                // Send via backend
                const payload = {
                    recipient: messageForm.recipient,
                    type: messageForm.type,
                    message: messageForm.message,
                    templateName: messageForm.templateName,
                    templateLanguage: messageForm.templateLanguage,
                    templateParams: messageForm.templateParams,
                    tenant_id: messageForm.tenantId || null,
                    // Only send manual credentials if no tenant is selected
                    phone_number_id: messageForm.tenantId ? null : config.phoneId,
                    access_token: messageForm.tenantId ? null : config.token,
                };

                const result = await api.sendMessage(payload);
                setStatus('success');
                setLogs(prev => [`[${timestamp}] ✅ Success (Backend): ${result.message_id}`, ...prev]);
            } else {
                // Direct call to Meta API
                const url = `https://graph.facebook.com/v22.0/${config.phoneId}/messages`;

                let payload = {
                    messaging_product: 'whatsapp',
                    to: messageForm.recipient,
                };

                if (messageForm.type === 'text') {
                    payload.type = 'text';
                    payload.text = { body: messageForm.message };
                } else {
                    payload.type = 'template';
                    payload.template = {
                        name: messageForm.templateName,
                        language: { code: messageForm.templateLanguage },
                    };

                    if (messageForm.templateParams && messageForm.templateParams.length > 0) {
                        payload.template.components = messageForm.templateParams;
                    }
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                const data = await res.json();

                if (res.ok) {
                    setStatus('success');
                    setLogs(prev => [`[${timestamp}] ✅ Success (Direct): ${data.messages?.[0]?.id}`, ...prev]);
                } else {
                    setStatus('error');
                    setLogs(prev => [`[${timestamp}] ❌ Error: ${data.error?.message}`, ...prev]);
                }
            }
        } catch (error) {
            setStatus('error');
            setLogs(prev => [`[${timestamp}] ❌ Error: ${error.message || error.toString()}`, ...prev]);
        }
    };

    const getBodyParams = () => {
        const bodyComp = messageForm.templateParams?.find(c => c.type === 'body');
        return bodyComp ? bodyComp.parameters : [];
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>منصة واتساب المباشرة</h1>
                    <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>أداة تشخيص وإرسال مباشر للتفاعل مع Meta Graph API.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {serverOnline === null ? (
                        <span style={{ color: 'hsl(var(--color-muted-foreground))' }}>فحص الخادم...</span>
                    ) : serverOnline ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--color-success))' }}>
                            <CheckCircle size={18} />
                            الخادم متصل
                        </span>
                    ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'hsl(var(--color-destructive))' }}>
                            <AlertCircle size={18} />
                            الخادم غير متصل
                        </span>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>

                {/* Left Column: Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* Configuration Card */}
                    <div className="card glass-panel">
                        <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Key size={20} className="text-accent" />
                            بيانات الربط (Configuration)
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Phone Number ID</label>
                                <input
                                    type="text"
                                    value={config.phoneId}
                                    onChange={e => setConfig({ ...config, phoneId: e.target.value })}
                                    placeholder="10595..."
                                />
                            </div>
                            <div className="form-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Access Token</label>
                                <input
                                    type="password"
                                    value={config.token}
                                    onChange={e => setConfig({ ...config, token: e.target.value })}
                                    placeholder="EAA..."
                                />
                            </div>
                        </div>

                        {/* Backend toggle */}
                        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={messageForm.sendViaBackend}
                                    onChange={(e) => setMessageForm({ ...messageForm, sendViaBackend: e.target.checked })}
                                    style={{ width: 'auto' }}
                                />
                                <span style={{ fontSize: '0.85rem' }}>إرسال عبر الخادم (Backend)</span>
                            </label>
                            {messageForm.sendViaBackend && tenants.length > 0 && (
                                <select
                                    value={messageForm.tenantId}
                                    onChange={(e) => setMessageForm({ ...messageForm, tenantId: e.target.value })}
                                    style={{ width: '180px', padding: '0.4rem' }}
                                >
                                    <option value="">اختر عميل (اختياري)</option>
                                    {tenants.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    {/* Message Tester Card */}
                    <div className="card glass-panel">
                        <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Smartphone size={20} className="text-accent" />
                            اختبار الإرسال
                        </h3>

                        <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>رقم المستلم</label>
                                <input
                                    type="text"
                                    value={messageForm.recipient}
                                    onChange={e => setMessageForm({ ...messageForm, recipient: e.target.value })}
                                    placeholder="مثال: 20100000000"
                                    required
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.8rem' }}>نوع الرسالة</label>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <label className={`button ${messageForm.type === 'text' ? 'button-primary' : 'button-secondary'}`} style={{ flex: 1 }}>
                                        <input
                                            type="radio"
                                            name="type"
                                            value="text"
                                            checked={messageForm.type === 'text'}
                                            onChange={() => setMessageForm({ ...messageForm, type: 'text' })}
                                            style={{ display: 'none' }}
                                        />
                                        نص (Text)
                                    </label>
                                    <label className={`button ${messageForm.type === 'template' ? 'button-primary' : 'button-secondary'}`} style={{ flex: 1 }}>
                                        <input
                                            type="radio"
                                            name="type"
                                            value="template"
                                            checked={messageForm.type === 'template'}
                                            onChange={() => setMessageForm({ ...messageForm, type: 'template' })}
                                            style={{ display: 'none' }}
                                        />
                                        قالب (Template)
                                    </label>
                                </div>
                            </div>

                            {messageForm.type === 'text' ? (
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>نص الرسالة</label>
                                    <textarea
                                        rows="4"
                                        value={messageForm.message}
                                        onChange={e => setMessageForm({ ...messageForm, message: e.target.value })}
                                        required
                                    ></textarea>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>اسم القالب</label>
                                            <input
                                                type="text"
                                                value={messageForm.templateName}
                                                onChange={e => setMessageForm({ ...messageForm, templateName: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>كود اللغة</label>
                                            <input
                                                type="text"
                                                value={messageForm.templateLanguage}
                                                onChange={e => setMessageForm({ ...messageForm, templateLanguage: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>

                                    {/* Template Parameters Section */}
                                    <div style={{ borderTop: '1px solid hsl(var(--color-secondary))', paddingTop: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>المتغيرات (Body Parameters)</label>
                                            <button type="button" onClick={addParam} className="button button-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>
                                                <Plus size={14} /> إضافة متغير
                                            </button>
                                        </div>

                                        {getBodyParams().length === 0 ? (
                                            <p style={{ fontSize: '0.8rem', color: 'hsl(var(--color-muted-foreground))', fontStyle: 'italic' }}>لا توجد متغيرات مضافة.</p>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {getBodyParams().map((param, index) => (
                                                    <div key={index} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--color-muted-foreground))', width: '30px' }}>{`{{${index + 1}}}`}</span>
                                                        <input
                                                            type="text"
                                                            placeholder={`قيمة المتغير ${index + 1}`}
                                                            value={param.text}
                                                            onChange={(e) => updateParam(index, e.target.value)}
                                                            style={{ flex: 1, padding: '0.5rem' }}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeParam(index)}
                                                            style={{ background: 'none', border: 'none', color: 'hsl(var(--color-destructive))', cursor: 'pointer' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                className="button"
                                disabled={status === 'loading'}
                                style={{
                                    background: 'linear-gradient(135deg, hsl(var(--color-accent)), #4338ca)',
                                    color: 'white',
                                    marginTop: '0.5rem',
                                    padding: '1rem'
                                }}
                            >
                                {status === 'loading' ? 'جاري الاتصال...' : (
                                    <>
                                        إرسال الآن <Send size={18} />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                </div>

                {/* Right Column: Logs */}
                <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: '600px' }}>
                    <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FileText size={20} />
                        سجلات التشغيل (Live Logs)
                    </h3>
                    <div style={{
                        background: '#0d0d0d',
                        flex: 1,
                        borderRadius: 'var(--radius)',
                        padding: '1rem',
                        overflowY: 'auto',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        {logs.length === 0 && <span style={{ color: '#444' }}>بانتظار العمليات...</span>}
                        {logs.map((log, i) => (
                            <div key={i} style={{
                                color: log.includes('Success') ? '#4ade80' : '#f87171',
                                borderBottom: '1px solid #222',
                                paddingBottom: '0.5rem'
                            }}>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default WhatsAppConsole;
