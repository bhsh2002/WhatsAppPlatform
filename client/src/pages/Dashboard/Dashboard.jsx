import React, { useState, useEffect } from 'react';
import { useTenants } from '../../context/TenantContext';
import { Users, AlertTriangle, CheckCircle, Activity, RefreshCw } from 'lucide-react';
import api from '../../api';

const Dashboard = () => {
    const { stats, fetchStats, loading: statsLoading } = useTenants();
    const [activity, setActivity] = useState([]);
    const [activityLoading, setActivityLoading] = useState(true);

    const fetchActivity = async () => {
        try {
            setActivityLoading(true);
            const data = await api.getActivity(5);
            setActivity(data);
        } catch (error) {
            console.error('Failed to fetch activity:', error);
        } finally {
            setActivityLoading(false);
        }
    };

    useEffect(() => {
        fetchActivity();
    }, []);

    const handleRefresh = () => {
        fetchStats();
        fetchActivity();
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'success':
                return <span className="badge badge-success">تم بنجاح</span>;
            case 'error':
                return <span className="badge badge-destructive">فشل</span>;
            case 'warning':
                return <span className="badge badge-warning">تحذير</span>;
            default:
                return <span className="badge">{status}</span>;
        }
    };

    const getEventDescription = (event) => {
        const descriptions = {
            'template_sent': 'إرسال حملة (Template)',
            'message_sent': 'إرسال رسالة',
            'message_received': 'رسالة واردة',
            'message_failed': 'فشل إرسال',
            'webhook_update': 'تحديث Webhook',
            'quality_drop': 'انخفاض الجودة (Quality Drop)',
            'quality_update': 'تحديث جودة الرقم',
            'tenant_created': 'إضافة عميل جديد',
            'tenant_updated': 'تحديث بيانات العميل',
            'tenant_deleted': 'حذف عميل',
        };
        return descriptions[event] || event;
    };

    const StatCard = ({ title, value, icon, color, description }) => (
        <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'hsl(var(--color-muted-foreground))', fontSize: '0.9rem' }}>{title}</span>
                <div style={{
                    padding: '0.5rem',
                    borderRadius: '50%',
                    background: `hsl(var(--color-${color}) / 0.1)`,
                    color: `hsl(var(--color-${color}))`
                }}>
                    {icon}
                </div>
            </div>
            <h3 style={{ fontSize: '2rem' }}>{statsLoading ? '...' : value}</h3>
            <span style={{ fontSize: '0.8rem', color: 'hsl(var(--color-muted-foreground))' }}>{description}</span>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>نظرة عامة</h1>
                    <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>ملخص أداء المنصة وحالة العملاء لليوم.</p>
                </div>
                <button
                    className="button button-secondary"
                    onClick={handleRefresh}
                    disabled={statsLoading || activityLoading}
                    style={{ gap: '0.5rem' }}
                >
                    <RefreshCw size={18} className={statsLoading || activityLoading ? 'spinning' : ''} />
                    تحديث
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                <StatCard
                    title="إجمالي العملاء"
                    value={stats.total}
                    icon={<Users size={24} />}
                    color="primary-foreground"
                    description="جميع الشركات المسجلة"
                />
                <StatCard
                    title="عملاء نشطين"
                    value={stats.active}
                    icon={<CheckCircle size={24} />}
                    color="success"
                    description="حالة الربط والتشغيل سليمة"
                />
                <StatCard
                    title="تحتاج انتباه"
                    value={stats.warning}
                    icon={<AlertTriangle size={24} />}
                    color="warning"
                    description="جودة متوسطة أو اقتراب من الحدود"
                />
                <StatCard
                    title="مشاكل حرجة"
                    value={stats.critical}
                    icon={<Activity size={24} />}
                    color="destructive"
                    description="حظر أو انقطاع خدمة"
                />
            </div>

            <div className="card glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3>النشاط الأخير</h3>
                    <button className="button button-secondary" onClick={() => window.location.href = '/logs'}>
                        عرض السجل الكامل
                    </button>
                </div>

                {activityLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        جاري التحميل...
                    </div>
                ) : activity.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        لا توجد أنشطة حتى الآن
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid hsl(var(--color-secondary))', textAlign: 'right' }}>
                                <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الوقت</th>
                                <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>العميل</th>
                                <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الحدث</th>
                                <th style={{ padding: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>الحالة</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activity.map((item) => (
                                <tr key={item.id}>
                                    <td style={{ padding: '1rem' }}>{item.relativeTime}</td>
                                    <td style={{ padding: '1rem' }}>{item.tenant_name || 'غير محدد'}</td>
                                    <td style={{ padding: '1rem' }}>{item.description || getEventDescription(item.event_type)}</td>
                                    <td style={{ padding: '1rem' }}>{getStatusBadge(item.status)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
