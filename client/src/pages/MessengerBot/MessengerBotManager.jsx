import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    Grid,
    IconButton,
    MenuItem,
    Paper,
    Snackbar,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    Edit as EditIcon,
    Inventory2 as ProductIcon,
    PlayArrow as TestIcon,
    Refresh as RefreshIcon,
    SmartToy as BotIcon,
    UploadFile as UploadIcon,
} from '@mui/icons-material';
import api from '../../api';

const emptyProduct = {
    sku: '',
    name: '',
    description: '',
    price: 0,
    currency: 'LYD',
    image_url: '',
    product_url: '',
    category: '',
    availability: 'available',
    is_active: true,
};

const emptyFlow = {
    name: '',
    linked_page_id: '',
    trigger_type: 'keyword',
    trigger_value: '',
    priority: 100,
    status: 'draft',
    description: '',
    node_type: 'text',
    body: '',
    category: '',
    empty_text: '',
    limit: 10,
    quick_replies_text: '',
    service_items_text: '',
};

function parseConfig(value) {
    if (!value) return {};
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return {};
    }
}

function toLines(items = []) {
    return items.map(item => `${item.title || ''}|${item.payload || ''}`).join('\n');
}

function parseLines(value) {
    return String(value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [title, ...rest] = line.split('|');
            return { title: title.trim(), payload: rest.join('|').trim() || `BOT:SERVICE:${title.trim()}` };
        });
}

function flowToForm(flow) {
    const config = parseConfig(flow?.config_json || flow?.node?.config_json);
    return {
        ...emptyFlow,
        id: flow.id,
        name: flow.name || '',
        linked_page_id: flow.linked_page_id || '',
        trigger_type: flow.trigger_type || 'keyword',
        trigger_value: flow.trigger_value || '',
        priority: flow.priority || 100,
        status: flow.status || 'draft',
        description: flow.description || '',
        node_type: flow.node_type || flow.node?.node_type || 'text',
        body: flow.body || flow.node?.body || '',
        category: config.category || '',
        empty_text: config.empty_text || '',
        limit: config.limit || 10,
        quick_replies_text: toLines(config.quick_replies || []),
        service_items_text: toLines(config.items || []),
    };
}

function buildFlowPayload(form) {
    const config = {};
    if (form.node_type === 'product_list') {
        config.category = form.category || null;
        config.limit = Number(form.limit) || 10;
        config.empty_text = form.empty_text || 'لا توجد منتجات متاحة حاليا.';
    }
    if (form.node_type === 'quick_replies') {
        config.quick_replies = parseLines(form.quick_replies_text);
    }
    if (form.node_type === 'service_menu') {
        config.items = parseLines(form.service_items_text);
    }

    return {
        name: form.name,
        linked_page_id: form.linked_page_id || null,
        trigger_type: form.trigger_type,
        trigger_value: form.trigger_value,
        priority: Number(form.priority) || 100,
        status: form.status,
        description: form.description,
        node: {
            node_key: 'start',
            node_type: form.node_type,
            body: form.body,
            config,
        },
    };
}

const StatBox = ({ title, value, color = 'primary' }) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, height: '100%' }}>
        <Typography variant="caption" color="text.secondary">{title}</Typography>
        <Typography variant="h5" fontWeight={800} color={`${color}.main`}>{value}</Typography>
    </Paper>
);

const MessengerBotManager = ({ tenantMode = false }) => {
    const [tab, setTab] = useState(0);
    const [tenants, setTenants] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [summary, setSummary] = useState(null);
    const [products, setProducts] = useState([]);
    const [flows, setFlows] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [productDialog, setProductDialog] = useState(false);
    const [flowDialog, setFlowDialog] = useState(false);
    const [productForm, setProductForm] = useState(emptyProduct);
    const [flowForm, setFlowForm] = useState(emptyFlow);
    const [preview, setPreview] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const tenantId = tenantMode ? null : selectedTenantId;
    const pages = summary?.pages || [];
    const selectedTenantReady = tenantMode || Boolean(selectedTenantId);

    useEffect(() => {
        if (tenantMode) return;
        api.getTenants()
            .then(data => {
                const rows = Array.isArray(data) ? data : [];
                setTenants(rows);
                if (rows.length > 0) setSelectedTenantId(String(rows[0].id));
            })
            .catch(err => setSnackbar({ open: true, message: err.message || 'فشل جلب العملاء', severity: 'error' }));
    }, [tenantMode]);

    const botApi = useMemo(() => ({
        summary: () => tenantMode ? api.getPortalMessengerBotSummary() : api.getMessengerBotSummary(tenantId),
        products: () => tenantMode ? api.getPortalMessengerBotProducts() : api.getMessengerBotProducts(tenantId),
        flows: () => tenantMode ? api.getPortalMessengerBotFlows() : api.getMessengerBotFlows(tenantId),
        sessions: () => tenantMode ? api.getPortalMessengerBotSessions() : api.getMessengerBotSessions(tenantId),
    }), [tenantMode, tenantId]);

    const loadAll = useCallback(async () => {
        if (!selectedTenantReady) return;
        try {
            setLoading(true);
            const [summaryData, productData, flowData, sessionData] = await Promise.all([
                botApi.summary(),
                botApi.products(),
                botApi.flows(),
                botApi.sessions(),
            ]);
            setSummary(summaryData);
            setProducts(Array.isArray(productData) ? productData : []);
            setFlows(Array.isArray(flowData) ? flowData : []);
            setSessions(Array.isArray(sessionData) ? sessionData : []);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحميل بيانات البوت', severity: 'error' });
        } finally {
            setLoading(false);
        }
    }, [botApi, selectedTenantReady]);

    useEffect(() => { loadAll(); }, [loadAll]);

    const saveProduct = async () => {
        try {
            if (!productForm.name.trim()) {
                setSnackbar({ open: true, message: 'اسم المنتج مطلوب', severity: 'warning' });
                return;
            }
            if (productForm.id) {
                if (tenantMode) await api.updatePortalMessengerBotProduct(productForm.id, productForm);
                else await api.updateMessengerBotProduct(tenantId, productForm.id, productForm);
            } else if (tenantMode) {
                await api.createPortalMessengerBotProduct(productForm);
            } else {
                await api.createMessengerBotProduct(tenantId, productForm);
            }
            setProductDialog(false);
            setSnackbar({ open: true, message: 'تم حفظ المنتج', severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حفظ المنتج', severity: 'error' });
        }
    };

    const deleteProduct = async (product) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotProduct(product.id);
            else await api.deleteMessengerBotProduct(tenantId, product.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف المنتج', severity: 'error' });
        }
    };

    const importProducts = async (file) => {
        if (!file) return;
        try {
            const result = tenantMode
                ? await api.importPortalMessengerBotProducts(file)
                : await api.importMessengerBotProducts(tenantId, file);
            setSnackbar({ open: true, message: `تم استيراد ${result.imported || 0} منتج`, severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل استيراد المنتجات', severity: 'error' });
        }
    };

    const saveFlow = async () => {
        try {
            if (!flowForm.name.trim()) {
                setSnackbar({ open: true, message: 'اسم المسار مطلوب', severity: 'warning' });
                return;
            }
            const payload = buildFlowPayload(flowForm);
            if (flowForm.id) {
                if (tenantMode) await api.updatePortalMessengerBotFlow(flowForm.id, payload);
                else await api.updateMessengerBotFlow(tenantId, flowForm.id, payload);
            } else if (tenantMode) {
                await api.createPortalMessengerBotFlow(payload);
            } else {
                await api.createMessengerBotFlow(tenantId, payload);
            }
            setFlowDialog(false);
            setPreview(null);
            setSnackbar({ open: true, message: 'تم حفظ المسار', severity: 'success' });
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حفظ المسار', severity: 'error' });
        }
    };

    const toggleFlow = async (flow) => {
        try {
            if (tenantMode) await api.togglePortalMessengerBotFlow(flow.id);
            else await api.toggleMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تغيير حالة المسار', severity: 'error' });
        }
    };

    const deleteFlow = async (flow) => {
        try {
            if (tenantMode) await api.deletePortalMessengerBotFlow(flow.id);
            else await api.deleteMessengerBotFlow(tenantId, flow.id);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف المسار', severity: 'error' });
        }
    };

    const testFlow = async (flow) => {
        try {
            const result = tenantMode
                ? await api.testPortalMessengerBotFlow(flow.id)
                : await api.testMessengerBotFlow(tenantId, flow.id);
            setPreview(result.preview);
            setFlowDialog(true);
            setFlowForm(flowToForm(flow));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل اختبار المسار', severity: 'error' });
        }
    };

    const updateSession = async (session, status) => {
        try {
            if (tenantMode) await api.updatePortalMessengerBotSession(session.id, status);
            else await api.updateMessengerBotSession(tenantId, session.id, status);
            await loadAll();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحديث الجلسة', severity: 'error' });
        }
    };

    const openProductDialog = (product = null) => {
        setProductForm(product ? { ...emptyProduct, ...product, is_active: Boolean(product.is_active) } : emptyProduct);
        setProductDialog(true);
    };

    const openFlowDialog = (flow = null) => {
        setPreview(null);
        setFlowForm(flow ? flowToForm(flow) : emptyFlow);
        setFlowDialog(true);
    };

    if (!tenantMode && tenants.length === 0) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="info">اختر عميلا أولا من إدارة العملاء لاستخدام Messenger Bot.</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h5" fontWeight={800} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <BotIcon color="primary" /> Messenger Bot
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        مسارات موجهة لعرض المنتجات والخدمات والتحويل لموظف عند الحاجة.
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                    {!tenantMode && (
                        <TextField
                            select
                            size="small"
                            label="العميل"
                            value={selectedTenantId}
                            onChange={e => setSelectedTenantId(e.target.value)}
                            sx={{ minWidth: 220 }}
                        >
                            {tenants.map(tenant => (
                                <MenuItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</MenuItem>
                            ))}
                        </TextField>
                    )}
                    <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadAll}>
                        تحديث
                    </Button>
                </Stack>
            </Stack>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
            ) : (
                <>
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid item xs={6} md={3}><StatBox title="المنتجات النشطة" value={summary?.products?.active || 0} /></Grid>
                        <Grid item xs={6} md={3}><StatBox title="كل المنتجات" value={summary?.products?.total || 0} color="info" /></Grid>
                        <Grid item xs={6} md={3}><StatBox title="Flows فعالة" value={summary?.flows?.active || 0} color="success" /></Grid>
                        <Grid item xs={6} md={3}><StatBox title="صفحات Messenger" value={pages.length} color="secondary" /></Grid>
                    </Grid>

                    <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
                            <Tab label="المنتجات" />
                            <Tab label="المسارات" />
                            <Tab label="الجلسات" />
                        </Tabs>
                        <Divider />

                        {tab === 0 && (
                            <Box sx={{ p: 2 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 2 }}>
                                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openProductDialog()}>
                                        إضافة منتج
                                    </Button>
                                    <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                                        استيراد CSV
                                        <input hidden type="file" accept=".csv,text/csv" onChange={e => importProducts(e.target.files?.[0])} />
                                    </Button>
                                </Stack>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المنتج</TableCell>
                                            <TableCell>التصنيف</TableCell>
                                            <TableCell>السعر</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {products.map(product => (
                                            <TableRow key={product.id}>
                                                <TableCell>
                                                    <Stack direction="row" spacing={1} alignItems="center">
                                                        <ProductIcon fontSize="small" color="action" />
                                                        <Box>
                                                            <Typography variant="body2" fontWeight={700}>{product.name}</Typography>
                                                            <Typography variant="caption" color="text.secondary">{product.sku || product.description || 'بدون وصف'}</Typography>
                                                        </Box>
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>{product.category || 'عام'}</TableCell>
                                                <TableCell>{Number(product.price || 0).toLocaleString('ar-LY')} {product.currency}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        label={product.is_active ? product.availability : 'inactive'}
                                                        color={product.is_active && product.availability === 'available' ? 'success' : 'default'}
                                                    />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <IconButton size="small" onClick={() => openProductDialog(product)}><EditIcon fontSize="small" /></IconButton>
                                                    <IconButton size="small" color="error" onClick={() => deleteProduct(product)}><DeleteIcon fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {products.length === 0 && (
                                            <TableRow><TableCell colSpan={5} align="center">لا توجد منتجات بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 1 && (
                            <Box sx={{ p: 2 }}>
                                <Button variant="contained" startIcon={<AddIcon />} onClick={() => openFlowDialog()} sx={{ mb: 2 }}>
                                    إضافة مسار
                                </Button>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المسار</TableCell>
                                            <TableCell>Trigger</TableCell>
                                            <TableCell>نوع الرد</TableCell>
                                            <TableCell>الصفحة</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {flows.map(flow => (
                                            <TableRow key={flow.id}>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={700}>{flow.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">{flow.description || flow.body || '—'}</Typography>
                                                </TableCell>
                                                <TableCell>{flow.trigger_type}{flow.trigger_value ? `: ${flow.trigger_value}` : ''}</TableCell>
                                                <TableCell>{flow.node_type || 'text'}</TableCell>
                                                <TableCell>{flow.page_name || 'كل الصفحات'}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={flow.status} color={flow.status === 'active' ? 'success' : 'default'} />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <IconButton size="small" onClick={() => testFlow(flow)}><TestIcon fontSize="small" /></IconButton>
                                                    <IconButton size="small" onClick={() => openFlowDialog(flow)}><EditIcon fontSize="small" /></IconButton>
                                                    <Button size="small" onClick={() => toggleFlow(flow)}>{flow.status === 'active' ? 'إيقاف' : 'تفعيل'}</Button>
                                                    <IconButton size="small" color="error" onClick={() => deleteFlow(flow)}><DeleteIcon fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {flows.length === 0 && (
                                            <TableRow><TableCell colSpan={6} align="center">لا توجد مسارات بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}

                        {tab === 2 && (
                            <Box sx={{ p: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>المستخدم</TableCell>
                                            <TableCell>الصفحة</TableCell>
                                            <TableCell>Flow</TableCell>
                                            <TableCell>الحالة</TableCell>
                                            <TableCell>آخر تحديث</TableCell>
                                            <TableCell align="right">إجراءات</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {sessions.map(session => (
                                            <TableRow key={session.id}>
                                                <TableCell>{session.user_name || session.user_psid}</TableCell>
                                                <TableCell>{session.page_name || session.linked_page_id}</TableCell>
                                                <TableCell>{session.flow_name || '—'}</TableCell>
                                                <TableCell><Chip size="small" label={session.status} color={session.status === 'handoff' ? 'warning' : 'success'} /></TableCell>
                                                <TableCell>{session.updated_at}</TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => updateSession(session, session.status === 'handoff' ? 'active' : 'handoff')}>
                                                        {session.status === 'handoff' ? 'إرجاع للبوت' : 'تحويل لموظف'}
                                                    </Button>
                                                    <Button size="small" color="inherit" onClick={() => updateSession(session, 'closed')}>إغلاق</Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {sessions.length === 0 && (
                                            <TableRow><TableCell colSpan={6} align="center">لا توجد جلسات بوت بعد</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}
                    </Paper>
                </>
            )}

            <Dialog open={productDialog} onClose={() => setProductDialog(false)} maxWidth="md" fullWidth>
                <DialogTitle>{productForm.id ? 'تعديل منتج' : 'إضافة منتج'}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} md={6}><TextField fullWidth label="الاسم" value={productForm.name} onChange={e => setProductForm(prev => ({ ...prev, name: e.target.value }))} /></Grid>
                        <Grid item xs={12} md={6}><TextField fullWidth label="SKU" value={productForm.sku} onChange={e => setProductForm(prev => ({ ...prev, sku: e.target.value }))} /></Grid>
                        <Grid item xs={12}><TextField fullWidth multiline minRows={2} label="الوصف" value={productForm.description} onChange={e => setProductForm(prev => ({ ...prev, description: e.target.value }))} /></Grid>
                        <Grid item xs={6} md={3}><TextField fullWidth type="number" label="السعر" value={productForm.price} onChange={e => setProductForm(prev => ({ ...prev, price: e.target.value }))} /></Grid>
                        <Grid item xs={6} md={3}><TextField fullWidth label="العملة" value={productForm.currency} onChange={e => setProductForm(prev => ({ ...prev, currency: e.target.value }))} /></Grid>
                        <Grid item xs={12} md={3}><TextField fullWidth label="التصنيف" value={productForm.category} onChange={e => setProductForm(prev => ({ ...prev, category: e.target.value }))} /></Grid>
                        <Grid item xs={12} md={3}>
                            <TextField select fullWidth label="التوفر" value={productForm.availability} onChange={e => setProductForm(prev => ({ ...prev, availability: e.target.value }))}>
                                <MenuItem value="available">متاح</MenuItem>
                                <MenuItem value="out_of_stock">غير متوفر</MenuItem>
                                <MenuItem value="hidden">مخفي</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={6}><TextField fullWidth label="رابط الصورة" value={productForm.image_url} onChange={e => setProductForm(prev => ({ ...prev, image_url: e.target.value }))} /></Grid>
                        <Grid item xs={12} md={6}><TextField fullWidth label="رابط المنتج" value={productForm.product_url} onChange={e => setProductForm(prev => ({ ...prev, product_url: e.target.value }))} /></Grid>
                        <Grid item xs={12}>
                            <FormControlLabel
                                control={<Switch checked={Boolean(productForm.is_active)} onChange={e => setProductForm(prev => ({ ...prev, is_active: e.target.checked }))} />}
                                label="منتج نشط"
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setProductDialog(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={saveProduct}>حفظ</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={flowDialog} onClose={() => setFlowDialog(false)} maxWidth="md" fullWidth>
                <DialogTitle>{flowForm.id ? 'تعديل مسار' : 'إضافة مسار'}</DialogTitle>
                <DialogContent>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                        <Grid item xs={12} md={6}><TextField fullWidth label="اسم المسار" value={flowForm.name} onChange={e => setFlowForm(prev => ({ ...prev, name: e.target.value }))} /></Grid>
                        <Grid item xs={12} md={6}>
                            <TextField select fullWidth label="صفحة Facebook" value={flowForm.linked_page_id} onChange={e => setFlowForm(prev => ({ ...prev, linked_page_id: e.target.value }))}>
                                <MenuItem value="">كل الصفحات</MenuItem>
                                {pages.map(page => <MenuItem key={page.id} value={page.id}>{page.page_name || page.page_id}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={4}>
                            <TextField select fullWidth label="Trigger" value={flowForm.trigger_type} onChange={e => setFlowForm(prev => ({ ...prev, trigger_type: e.target.value }))}>
                                <MenuItem value="welcome">أول رسالة</MenuItem>
                                <MenuItem value="keyword">كلمة مفتاحية</MenuItem>
                                <MenuItem value="postback">Postback</MenuItem>
                                <MenuItem value="fallback">Fallback</MenuItem>
                                <MenuItem value="menu">القائمة</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12} md={5}><TextField fullWidth label="قيمة Trigger" value={flowForm.trigger_value} onChange={e => setFlowForm(prev => ({ ...prev, trigger_value: e.target.value }))} helperText="للكلمات المفتاحية استخدم فاصلة أو سطر لكل كلمة" /></Grid>
                        <Grid item xs={6} md={1.5}><TextField fullWidth type="number" label="الأولوية" value={flowForm.priority} onChange={e => setFlowForm(prev => ({ ...prev, priority: e.target.value }))} /></Grid>
                        <Grid item xs={6} md={1.5}>
                            <TextField select fullWidth label="الحالة" value={flowForm.status} onChange={e => setFlowForm(prev => ({ ...prev, status: e.target.value }))}>
                                <MenuItem value="draft">Draft</MenuItem>
                                <MenuItem value="active">Active</MenuItem>
                                <MenuItem value="paused">Paused</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField select fullWidth label="نوع الرد" value={flowForm.node_type} onChange={e => setFlowForm(prev => ({ ...prev, node_type: e.target.value }))}>
                                <MenuItem value="text">نص</MenuItem>
                                <MenuItem value="quick_replies">Quick Replies</MenuItem>
                                <MenuItem value="product_list">قائمة منتجات</MenuItem>
                                <MenuItem value="service_menu">قائمة خدمات</MenuItem>
                                <MenuItem value="handoff">تحويل لموظف</MenuItem>
                            </TextField>
                        </Grid>
                        <Grid item xs={12}><TextField fullWidth multiline minRows={3} label="نص الرد" value={flowForm.body} onChange={e => setFlowForm(prev => ({ ...prev, body: e.target.value }))} /></Grid>
                        {flowForm.node_type === 'product_list' && (
                            <>
                                <Grid item xs={12} md={4}><TextField fullWidth label="تصنيف المنتجات" value={flowForm.category} onChange={e => setFlowForm(prev => ({ ...prev, category: e.target.value }))} helperText="اتركه فارغا لعرض أحدث المنتجات" /></Grid>
                                <Grid item xs={12} md={2}><TextField fullWidth type="number" label="العدد" value={flowForm.limit} onChange={e => setFlowForm(prev => ({ ...prev, limit: e.target.value }))} /></Grid>
                                <Grid item xs={12} md={6}><TextField fullWidth label="رسالة عدم توفر منتجات" value={flowForm.empty_text} onChange={e => setFlowForm(prev => ({ ...prev, empty_text: e.target.value }))} /></Grid>
                            </>
                        )}
                        {flowForm.node_type === 'quick_replies' && (
                            <Grid item xs={12}>
                                <TextField fullWidth multiline minRows={3} label="Quick Replies" value={flowForm.quick_replies_text} onChange={e => setFlowForm(prev => ({ ...prev, quick_replies_text: e.target.value }))} helperText="صيغة كل سطر: العنوان|payload" />
                            </Grid>
                        )}
                        {flowForm.node_type === 'service_menu' && (
                            <Grid item xs={12}>
                                <TextField fullWidth multiline minRows={3} label="الخدمات" value={flowForm.service_items_text} onChange={e => setFlowForm(prev => ({ ...prev, service_items_text: e.target.value }))} helperText="صيغة كل سطر: اسم الخدمة|payload" />
                            </Grid>
                        )}
                        {preview && (
                            <Grid item xs={12}>
                                <Alert severity="info">
                                    {preview.message}
                                    {preview.products?.length > 0 && (
                                        <Box sx={{ mt: 1 }}>{preview.products.map(product => product.name).join('، ')}</Box>
                                    )}
                                </Alert>
                            </Grid>
                        )}
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFlowDialog(false)}>إلغاء</Button>
                    <Button variant="contained" onClick={saveFlow}>حفظ</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MessengerBotManager;
