import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogIn, User, Lock, AlertCircle, Loader } from 'lucide-react';

const Login = () => {
    const { login, register, loading, error } = useAuth();
    const [isRegister, setIsRegister] = useState(false);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        name: '',
        email: ''
    });
    const [localError, setLocalError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');

        if (isRegister) {
            if (formData.password.length < 6) {
                setLocalError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
                return;
            }
            const result = await register(formData);
            if (!result.success) {
                setLocalError(result.error);
            }
        } else {
            const result = await login(formData.username, formData.password);
            if (!result.success) {
                setLocalError(result.error);
            }
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, hsl(240 10% 3.9%), #0a0a1a)',
            padding: '2rem'
        }}>
            <div style={{
                width: '100%',
                maxWidth: '420px'
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'white',
                        borderRadius: '16px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '1rem'
                    }}>
                        <span style={{ fontSize: '2rem' }}>⚡</span>
                    </div>
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>مراقب واتساب</h1>
                    <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>لوحة الإدارة المركزية</p>
                </div>

                {/* Form Card */}
                <div className="card glass-panel">
                    <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                        {isRegister ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}
                    </h2>

                    {(localError || error) && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.75rem',
                            background: 'hsl(var(--color-destructive) / 0.1)',
                            border: '1px solid hsl(var(--color-destructive) / 0.3)',
                            borderRadius: 'var(--radius)',
                            marginBottom: '1rem',
                            color: 'hsl(var(--color-destructive))'
                        }}>
                            <AlertCircle size={18} />
                            <span style={{ fontSize: '0.9rem' }}>{localError || error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                <User size={16} />
                                اسم المستخدم
                            </label>
                            <input
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                placeholder="admin"
                                required
                                autoFocus
                            />
                        </div>

                        {isRegister && (
                            <>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                        الاسم الكامل
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="محمد أحمد"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                        البريد الإلكتروني
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        placeholder="email@example.com"
                                    />
                                </div>
                            </>
                        )}

                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                <Lock size={16} />
                                كلمة المرور
                            </label>
                            <input
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            className="button"
                            disabled={loading}
                            style={{
                                background: 'linear-gradient(135deg, hsl(var(--color-accent)), #4338ca)',
                                color: 'white',
                                padding: '1rem',
                                marginTop: '0.5rem'
                            }}
                        >
                            {loading ? (
                                <><Loader size={18} className="spinning" /> جاري التحميل...</>
                            ) : (
                                <><LogIn size={18} /> {isRegister ? 'إنشاء الحساب' : 'دخول'}</>
                            )}
                        </button>
                    </form>

                    <div style={{
                        textAlign: 'center',
                        marginTop: '1.5rem',
                        paddingTop: '1.5rem',
                        borderTop: '1px solid hsl(var(--color-secondary))'
                    }}>
                        <button
                            onClick={() => {
                                setIsRegister(!isRegister);
                                setLocalError('');
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'hsl(var(--color-accent))',
                                cursor: 'pointer',
                                fontSize: '0.9rem'
                            }}
                        >
                            {isRegister ? 'لديك حساب؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد'}
                        </button>
                    </div>
                </div>

                {/* Default credentials hint */}
                {!isRegister && (
                    <div style={{
                        textAlign: 'center',
                        marginTop: '1rem',
                        padding: '0.75rem',
                        background: 'hsl(var(--color-secondary) / 0.3)',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.8rem',
                        color: 'hsl(var(--color-muted-foreground))'
                    }}>
                        بيانات الدخول الافتراضية: <code style={{ color: 'hsl(var(--color-accent))' }}>admin</code> / <code style={{ color: 'hsl(var(--color-accent))' }}>admin123</code>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Login;
