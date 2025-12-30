import React, { useState } from 'react';
import { useTenants } from '../../context/TenantContext';
import { MoreHorizontal, Search, Plus, Trash2, Edit, X, Check, Loader } from 'lucide-react';

const TenantList = () => {
    const { tenants, loading, error, createTenant, updateTenant, deleteTenant } = useTenants();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingTenant, setEditingTenant] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        tier: '1K',
        credits: 0,
        status: 'Active',
        quality: 'High',
        phone_number_id: '',
        access_token: ''
    });
    const [actionMenu, setActionMenu] = useState(null);
    const [saving, setSaving] = useState(false);

    const filteredTenants = tenants.filter(tenant => {
        const matchesSearch = tenant.name.includes(searchQuery) ||
            tenant.phone?.includes(searchQuery) ||
            tenant.id.toString().includes(searchQuery);
        const matchesStatus = !statusFilter ||
            (statusFilter === 'active' && tenant.status === 'Active') ||
            (statusFilter === 'suspended' && tenant.status === 'Suspended');
        return matchesSearch && matchesStatus;
    });

    const getStatusBadge = (status, quality) => {
        if (status === 'Suspended' || quality === 'Low') return <span className="badge badge-destructive">موقوف/حرج</span>;
        if (status === 'Warning' || quality === 'Medium') return <span className="badge badge-warning">تحذير</span>;
        return <span className="badge badge-success">نشط</span>;
    };

    const openCreateModal = () => {
        setEditingTenant(null);
        setFormData({
            name: '',
            phone: '',
            tier: '1K',
            credits: 0,
            status: 'Active',
            quality: 'High',
            phone_number_id: '',
            access_token: ''
        });
        setShowModal(true);
    };

    const openEditModal = (tenant) => {
        setEditingTenant(tenant);
        setFormData({
            name: tenant.name,
            phone: tenant.phone || '',
            tier: tenant.tier,
            credits: tenant.credits,
            status: tenant.status,
            quality: tenant.quality,
            phone_number_id: tenant.phone_number_id || '',
            access_token: tenant.access_token || ''
        });
        setShowModal(true);
        setActionMenu(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            if (editingTenant) {
                await updateTenant(editingTenant.id, formData);
            } else {
                await createTenant(formData);
            }
            setShowModal(false);
        } catch (error) {
            alert('حدث خطأ: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (tenant) => {
        if (confirm(`هل أنت متأكد من حذف "${tenant.name}"؟`)) {
            try {
                await deleteTenant(tenant.id);
            } catch (error) {
                alert('حدث خطأ: ' + error.message);
            }
        }
        setActionMenu(null);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>إدارة العملاء</h1>
                    <p style={{ color: 'hsl(var(--color-muted-foreground))' }}>قائمة جميع المشتركين وحالتهم التقنية.</p>
                </div>
                <button className="button button-primary" onClick={openCreateModal} style={{ gap: '0.5rem' }}>
                    <Plus size={18} />
                    إضافة عميل جديد
                </button>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '1rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--color-muted-foreground))' }} size={20} />
                    <input
                        type="text"
                        placeholder="بحث باسم الشركة، رقم الهاتف، أو المعرف..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ paddingRight: '2.8rem' }}
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ width: '200px' }}
                >
                    <option value="">كل الحالات</option>
                    <option value="active">نشط</option>
                    <option value="suspended">موقوف</option>
                </select>
            </div>

            {error && (
                <div className="card" style={{ background: 'hsl(var(--color-destructive) / 0.1)', borderColor: 'hsl(var(--color-destructive))' }}>
                    <p style={{ color: 'hsl(var(--color-destructive))' }}>خطأ: {error}</p>
                </div>
            )}

            <div className="card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        جاري التحميل...
                    </div>
                ) : filteredTenants.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        لا يوجد عملاء
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'hsl(var(--color-secondary) / 0.5)' }}>
                            <tr style={{ textAlign: 'right' }}>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>اسم العميل</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>رقم الهاتف</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>المستوى (Tier)</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>الرصيد</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>جودة الرقم</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>الحالة</th>
                                <th style={{ padding: '1.2rem', color: 'hsl(var(--color-muted-foreground))', fontWeight: 500 }}>إجراءات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTenants.map((tenant) => (
                                <tr key={tenant.id} style={{ borderBottom: '1px solid hsl(var(--color-secondary))' }}>
                                    <td style={{ padding: '1.2rem', fontWeight: 600 }}>{tenant.name}</td>
                                    <td style={{ padding: '1.2rem', fontFamily: 'monospace' }}>{tenant.phone}</td>
                                    <td style={{ padding: '1.2rem' }}>{tenant.tier}</td>
                                    <td style={{ padding: '1.2rem' }}>{tenant.credits?.toLocaleString()} SAR</td>
                                    <td style={{ padding: '1.2rem' }}>
                                        <span style={{
                                            color: tenant.quality === 'High' ? 'hsl(var(--color-success))' :
                                                tenant.quality === 'Medium' ? 'hsl(var(--color-warning))' : 'hsl(var(--color-destructive))',
                                            fontWeight: 600
                                        }}>
                                            {tenant.quality}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1.2rem' }}>{getStatusBadge(tenant.status, tenant.quality)}</td>
                                    <td style={{ padding: '1.2rem', position: 'relative' }}>
                                        <button
                                            className="button button-secondary"
                                            style={{ padding: '0.4rem' }}
                                            onClick={() => setActionMenu(actionMenu === tenant.id ? null : tenant.id)}
                                        >
                                            <MoreHorizontal size={18} />
                                        </button>
                                        {actionMenu === tenant.id && (
                                            <div style={{
                                                position: 'absolute',
                                                left: '0',
                                                top: '100%',
                                                background: 'hsl(var(--color-card))',
                                                border: '1px solid hsl(var(--color-secondary))',
                                                borderRadius: 'var(--radius)',
                                                padding: '0.5rem',
                                                zIndex: 100,
                                                minWidth: '120px',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                                            }}>
                                                <button
                                                    onClick={() => openEditModal(tenant)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        background: 'none',
                                                        border: 'none',
                                                        color: 'white',
                                                        cursor: 'pointer',
                                                        borderRadius: 'var(--radius)'
                                                    }}
                                                    onMouseOver={(e) => e.target.style.background = 'hsl(var(--color-secondary))'}
                                                    onMouseOut={(e) => e.target.style.background = 'none'}
                                                >
                                                    <Edit size={16} /> تعديل
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(tenant)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        background: 'none',
                                                        border: 'none',
                                                        color: 'hsl(var(--color-destructive))',
                                                        cursor: 'pointer',
                                                        borderRadius: 'var(--radius)'
                                                    }}
                                                    onMouseOver={(e) => e.target.style.background = 'hsl(var(--color-destructive) / 0.1)'}
                                                    onMouseOut={(e) => e.target.style.background = 'none'}
                                                >
                                                    <Trash2 size={16} /> حذف
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }} onClick={() => setShowModal(false)}>
                    <div
                        className="card glass-panel"
                        style={{ width: '500px', maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2>{editingTenant ? 'تعديل العميل' : 'إضافة عميل جديد'}</h2>
                            <button className="button" style={{ padding: '0.3rem' }} onClick={() => setShowModal(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>اسم العميل *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>رقم الهاتف</label>
                                <input
                                    type="text"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+966500000000"
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>المستوى</label>
                                    <select
                                        value={formData.tier}
                                        onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                                    >
                                        <option value="1K">1K</option>
                                        <option value="10K">10K</option>
                                        <option value="100K">100K</option>
                                        <option value="Unlimited">Unlimited</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>الرصيد</label>
                                    <input
                                        type="number"
                                        value={formData.credits}
                                        onChange={(e) => setFormData({ ...formData, credits: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>الحالة</label>
                                    <select
                                        value={formData.status}
                                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                    >
                                        <option value="Active">نشط</option>
                                        <option value="Warning">تحذير</option>
                                        <option value="Suspended">موقوف</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>الجودة</label>
                                    <select
                                        value={formData.quality}
                                        onChange={(e) => setFormData({ ...formData, quality: e.target.value })}
                                    >
                                        <option value="High">High</option>
                                        <option value="Medium">Medium</option>
                                        <option value="Low">Low</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid hsl(var(--color-secondary))', paddingTop: '1rem', marginTop: '0.5rem' }}>
                                <h4 style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>بيانات WhatsApp API (اختياري)</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Phone Number ID</label>
                                        <input
                                            type="text"
                                            value={formData.phone_number_id}
                                            onChange={(e) => setFormData({ ...formData, phone_number_id: e.target.value })}
                                            placeholder="105956789012345"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Access Token</label>
                                        <input
                                            type="password"
                                            value={formData.access_token}
                                            onChange={(e) => setFormData({ ...formData, access_token: e.target.value })}
                                            placeholder="EAA..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="button"
                                disabled={saving}
                                style={{
                                    background: 'linear-gradient(135deg, hsl(var(--color-accent)), #4338ca)',
                                    color: 'white',
                                    marginTop: '1rem',
                                    padding: '1rem'
                                }}
                            >
                                {saving ? (
                                    <><Loader size={18} className="spinning" /> جاري الحفظ...</>
                                ) : (
                                    <><Check size={18} /> {editingTenant ? 'حفظ التعديلات' : 'إضافة العميل'}</>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TenantList;
