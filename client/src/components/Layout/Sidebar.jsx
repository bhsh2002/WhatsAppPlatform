import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    MessageSquare,
    Settings,
    Activity,
    LogOut,
    User
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const navItems = [
        { label: 'لوحة القيادة', path: '/', icon: <LayoutDashboard size={20} /> },
        { label: 'إدارة العملاء', path: '/tenants', icon: <Users size={20} /> },
        { label: 'منصة واتساب', path: '/whatsapp', icon: <MessageSquare size={20} /> },
        { label: 'سجلات التشغيل', path: '/logs', icon: <Activity size={20} /> },
        { label: 'الإعدادات', path: '/settings', icon: <Settings size={20} /> },
    ];

    return (
        <aside className="sidebar">
            <div className="logo-area" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                    width: '40px',
                    height: '40px',
                    background: 'white',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>⚡</span>
                </div>
                <div>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: 0 }}>مراقب واتساب</h2>
                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>لوحة الإدارة المركزية</span>
                </div>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            isActive ? 'button button-secondary' : 'button'
                        }
                        style={({ isActive }) => ({
                            justifyContent: 'flex-start',
                            background: isActive ? 'hsl(var(--color-secondary))' : 'transparent',
                            color: isActive ? 'white' : 'hsl(var(--color-muted-foreground))'
                        })}
                    >
                        {item.icon}
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            {/* User info section */}
            <div style={{
                marginTop: 'auto',
                borderTop: '1px solid hsl(var(--color-secondary))',
                paddingTop: '1rem'
            }}>
                {user && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        background: 'hsl(var(--color-secondary) / 0.3)',
                        borderRadius: 'var(--radius)',
                        marginBottom: '0.75rem'
                    }}>
                        <div style={{
                            width: '36px',
                            height: '36px',
                            background: 'hsl(var(--color-accent))',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <User size={18} color="white" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontWeight: 600,
                                fontSize: '0.9rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}>
                                {user.name || user.username}
                            </div>
                            <div style={{
                                fontSize: '0.75rem',
                                color: 'hsl(var(--color-muted-foreground))',
                                textTransform: 'capitalize'
                            }}>
                                {user.role === 'admin' ? 'مدير' : user.role === 'viewer' ? 'مشاهد' : 'مستخدم'}
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleLogout}
                    className="button"
                    style={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        color: 'hsl(var(--color-destructive))'
                    }}
                >
                    <LogOut size={20} />
                    تسجيل الخروج
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
