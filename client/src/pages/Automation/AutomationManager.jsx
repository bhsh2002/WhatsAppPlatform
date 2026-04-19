import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, IconButton, Chip, Card, CardContent,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
    Switch, FormControlLabel, Checkbox, FormGroup, Alert, CircularProgress,
    Divider, Tooltip, Grid, Select, InputLabel, FormControl, RadioGroup, Radio,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    SmartToy as SmartToyIcon,
    VpnKey as KeywordIcon,
    WavingHand as WelcomeIcon,
    NightsStay as AwayIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    PlayArrow as TestIcon,
    Refresh as RefreshIcon,
    CheckCircle as CheckCircleIcon,
    Cancel as CancelIcon,
    Science as ScienceIcon,
    ChatBubble as CommentReplyIcon,
    Facebook as FBPageIcon
} from '@mui/icons-material';
import api from '../../api';

const RULE_TYPES = [
    { value: 'keyword', label: 'كلمة مفتاحية', icon: <KeywordIcon /> },
    { value: 'welcome', label: 'رسالة ترحيب', icon: <WelcomeIcon /> },
    { value: 'away', label: 'خارج الدوام', icon: <AwayIcon /> },
    { value: 'comment_reply', label: 'رد على التعليقات', icon: <CommentReplyIcon /> },
];

const CHANNELS = [
    { value: 'all', label: 'جميع القنوات' },
    { value: 'whatsapp', label: 'واتساب' },
    { value: 'messenger', label: 'ماسنجر' },
    { value: 'facebook', label: 'فيسبوك' },
];

const RESPONSE_ACTIONS = [
    { value: 'comment', label: 'رد عام (تعليق)' },
    { value: 'dm', label: 'رسالة خاصة (DM)' },
    { value: 'both', label: 'كلاهما' },
];

const TRIGGER_ON_OPTIONS = [
    { value: 'comment', label: 'التعليقات فقط' },
    { value: 'reaction', label: 'التفاعلات/الإعجاب فقط' },
    { value: 'both', label: 'التعليقات والتفاعلات' },
];

const MATCH_TYPES = [
    { value: 'exact', label: 'مطابقة تامة' },
    { value: 'contains', label: 'يحتوي على' },
    { value: 'regex', label: 'تعبير نمطي (Regex)' },
];

const DAY_OPTIONS = [
    { value: 'sun', label: 'أحد' },
    { value: 'mon', label: 'اثنين' },
    { value: 'tue', label: 'ثلاثاء' },
    { value: 'wed', label: 'أربعاء' },
    { value: 'thu', label: 'خميس' },
    { value: 'fri', label: 'جمعة' },
    { value: 'sat', label: 'سبت' },
];

const emptyRule = {
    name: '',
    rule_type: 'keyword',
    channel: 'all',
    tenant_id: '',
    priority: 100,
    is_active: true,
    match_type: 'contains',
    match_pattern: '',
    match_case_sensitive: false,
    schedule_days: ['sun', 'mon', 'tue', 'wed', 'thu'],
    schedule_start_time: '20:00',
    schedule_end_time: '08:00',
    schedule_timezone: 'Africa/Tripoli',
    response_type: 'text',
    response_text: '',
    response_template_name: '',
    response_template_language: 'ar',
    cooldown_seconds: 300,
    target_post_id: '',
    target_page_id: '',
    response_action: 'comment',
    dm_text: '',
    trigger_on: 'comment',
};

const AutomationManager = () => {
    const [rules, setRules] = useState([]);
    const [tenants, setTenants] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRule, setEditingRule] = useState(null);
    const [formData, setFormData] = useState({ ...emptyRule });
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    // Filters
    const [filterType, setFilterType] = useState('');
    const [filterChannel, setFilterChannel] = useState('');

    // Test panel
    const [testChannel, setTestChannel] = useState('whatsapp');
    const [testTenantId, setTestTenantId] = useState('');
    const [testMessage, setTestMessage] = useState('');
    const [testNewContact, setTestNewContact] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

    // FB Pages for comment_reply
    const [fbPages, setFbPages] = useState([]);
    const [fbPosts, setFbPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(false);

    const fetchRules = useCallback(async () => {
        try {
            setLoading(true);
            const params = {};
            if (filterType) params.rule_type = filterType;
            if (filterChannel) params.channel = filterChannel;
            const data = await api.getAutomationRules(params);
            setRules(data);
        } catch (err) {
            console.error('Failed to fetch rules:', err);
        } finally {
            setLoading(false);
        }
    }, [filterType, filterChannel]);

    const fetchSummary = useCallback(async () => {
        try {
            const data = await api.getAutomationSummary();
            setSummary(data);
        } catch (err) {
            console.error('Failed to fetch summary:', err);
        }
    }, []);

    const fetchTenants = useCallback(async () => {
        try {
            const data = await api.getTenants();
            setTenants(data);
        } catch (err) {
            console.error('Failed to fetch tenants:', err);
        }
    }, []);

    useEffect(() => {
        fetchRules();
        fetchSummary();
        fetchTenants();
        fetchFbPages();
    }, [fetchRules, fetchSummary, fetchTenants]);

    const fetchFbPages = useCallback(async () => {
        try {
            const data = await api.getFbAllPages();
            setFbPages(Array.isArray(data) ? data : []);
        } catch {
            setFbPages([]);
        }
    }, []);

    const fetchPostsForPage = useCallback(async (linkedPageId) => {
        if (!linkedPageId) { setFbPosts([]); return; }
        try {
            setPostsLoading(true);
            const data = await api.getFbPosts(linkedPageId);
            setFbPosts(data?.posts || []);
        } catch {
            setFbPosts([]);
        } finally {
            setPostsLoading(false);
        }
    }, []);

    const handleOpenCreate = () => {
        setEditingRule(null);
        setFormData({ ...emptyRule });
        setDialogOpen(true);
    };

    const handleOpenEdit = (rule) => {
        setEditingRule(rule);
        let scheduleDays = [];
        try {
            scheduleDays = rule.schedule_days ? JSON.parse(rule.schedule_days) : [];
        } catch { scheduleDays = []; }

        setFormData({
            name: rule.name || '',
            rule_type: rule.rule_type || 'keyword',
            channel: rule.channel || 'all',
            tenant_id: rule.tenant_id || '',
            priority: rule.priority || 100,
            is_active: !!rule.is_active,
            match_type: rule.match_type || 'contains',
            match_pattern: rule.match_pattern || '',
            match_case_sensitive: !!rule.match_case_sensitive,
            schedule_days: scheduleDays,
            schedule_start_time: rule.schedule_start_time || '20:00',
            schedule_end_time: rule.schedule_end_time || '08:00',
            schedule_timezone: rule.schedule_timezone || 'Africa/Tripoli',
            response_type: rule.response_type || 'text',
            response_text: rule.response_text || '',
            response_template_name: rule.response_template_name || '',
            response_template_language: rule.response_template_language || 'ar',
            cooldown_seconds: rule.cooldown_seconds ?? 300,
            target_post_id: rule.target_post_id || '',
            target_page_id: rule.target_page_id || '',
            response_action: rule.response_action || 'comment',
            dm_text: rule.dm_text || '',
            trigger_on: rule.trigger_on || 'comment',
        });
        if (rule.target_page_id) fetchPostsForPage(rule.target_page_id);
        setDialogOpen(true);
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const isComment = formData.rule_type === 'comment_reply';
            const payload = {
                ...formData,
                tenant_id: formData.tenant_id || null,
                channel: isComment ? 'facebook' : formData.channel,
                schedule_days: formData.rule_type === 'away' ? JSON.stringify(formData.schedule_days) : null,
                schedule_start_time: formData.rule_type === 'away' ? formData.schedule_start_time : null,
                schedule_end_time: formData.rule_type === 'away' ? formData.schedule_end_time : null,
                match_type: (formData.rule_type === 'keyword' || isComment) ? formData.match_type : null,
                match_pattern: (formData.rule_type === 'keyword' || isComment) ? formData.match_pattern : null,
                target_post_id: isComment ? (formData.target_post_id || null) : null,
                target_page_id: isComment ? (formData.target_page_id || null) : null,
                response_action: isComment ? formData.response_action : 'comment',
                dm_text: isComment ? (formData.dm_text || null) : null,
                trigger_on: isComment ? formData.trigger_on : 'comment',
            };

            if (editingRule) {
                await api.updateAutomationRule(editingRule.id, payload);
            } else {
                await api.createAutomationRule(payload);
            }
            setDialogOpen(false);
            fetchRules();
            fetchSummary();
        } catch (err) {
            console.error('Failed to save rule:', err);
            alert(err.message || 'فشل حفظ القاعدة');
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (id) => {
        try {
            await api.toggleAutomationRule(id);
            fetchRules();
            fetchSummary();
        } catch (err) {
            console.error('Failed to toggle rule:', err);
        }
    };

    const handleDelete = async (id) => {
        try {
            await api.deleteAutomationRule(id);
            setDeleteConfirm(null);
            fetchRules();
            fetchSummary();
        } catch (err) {
            console.error('Failed to delete rule:', err);
        }
    };

    const handleTest = async () => {
        try {
            setTesting(true);
            setTestResult(null);
            const result = await api.testAutomationRule({
                channel: testChannel,
                tenant_id: testTenantId || null,
                message_text: testMessage,
                is_new_contact: testNewContact,
            });
            setTestResult(result);
        } catch (err) {
            console.error('Test failed:', err);
            setTestResult({ error: err.message });
        } finally {
            setTesting(false);
        }
    };

    const getRuleTypeLabel = (type) => RULE_TYPES.find(t => t.value === type)?.label || type;
    const getRuleTypeIcon = (type) => {
        switch (type) {
            case 'keyword': return <KeywordIcon sx={{ fontSize: 18 }} />;
            case 'welcome': return <WelcomeIcon sx={{ fontSize: 18 }} />;
            case 'away': return <AwayIcon sx={{ fontSize: 18 }} />;
            case 'comment_reply': return <CommentReplyIcon sx={{ fontSize: 18 }} />;
            default: return <SmartToyIcon sx={{ fontSize: 18 }} />;
        }
    };

    const getChannelChip = (ch) => {
        if (ch === 'whatsapp') return <Chip icon={<WhatsAppIcon />} label="واتساب" size="small" sx={{ bgcolor: '#25D36622', color: '#25D366' }} />;
        if (ch === 'messenger') return <Chip icon={<FacebookIcon />} label="ماسنجر" size="small" sx={{ bgcolor: '#0084ff22', color: '#0084ff' }} />;
        if (ch === 'facebook') return <Chip icon={<FBPageIcon />} label="فيسبوك" size="small" sx={{ bgcolor: '#1877f222', color: '#1877f2' }} />;
        return <Chip label="الكل" size="small" variant="outlined" />;
    };

    const formatCooldown = (seconds) => {
        if (seconds < 60) return `${seconds} ثانية`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)} دقيقة`;
        return `${Math.floor(seconds / 3600)} ساعة`;
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SmartToyIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                    <Typography variant="h5" fontWeight="bold">محرك الأتمتة</Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
                    قاعدة جديدة
                </Button>
            </Box>

            {/* Stats Cards */}
            {summary && (
                <Grid container spacing={2} sx={{ mb: 3 }}>
                    {[
                        { label: 'إجمالي القواعد', value: summary.total, icon: <SmartToyIcon />, color: '#6366f1' },
                        { label: 'نشطة', value: summary.active, icon: <CheckCircleIcon />, color: '#22c55e' },
                        { label: 'كلمات مفتاحية', value: summary.keywords, icon: <KeywordIcon />, color: '#f59e0b' },
                        { label: 'تشغيلات (الإجمالي)', value: summary.totalTriggers, icon: <TestIcon />, color: '#06b6d4' },
                    ].map((stat, i) => (
                        <Grid size={{ xs: 6, md: 3 }} key={i}>
                            <Card sx={{ textAlign: 'center' }}>
                                <CardContent sx={{ py: 2 }}>
                                    <Box sx={{ color: stat.color, mb: 0.5 }}>{stat.icon}</Box>
                                    <Typography variant="h5" fontWeight="bold">{stat.value}</Typography>
                                    <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Filters */}
            <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>نوع القاعدة</InputLabel>
                    <Select value={filterType} onChange={e => setFilterType(e.target.value)} label="نوع القاعدة">
                        <MenuItem value="">الكل</MenuItem>
                        {RULE_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>القناة</InputLabel>
                    <Select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} label="القناة">
                        <MenuItem value="">الكل</MenuItem>
                        {CHANNELS.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                    </Select>
                </FormControl>
                <Box sx={{ flex: 1 }} />
                <IconButton onClick={() => { fetchRules(); fetchSummary(); }} title="تحديث">
                    <RefreshIcon />
                </IconButton>
            </Paper>

            {/* Rules List */}
            {loading ? (
                <Box sx={{ textAlign: 'center', p: 4 }}><CircularProgress /></Box>
            ) : rules.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <SmartToyIcon sx={{ fontSize: 60, color: 'grey.300', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">لا توجد قواعد أتمتة</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        أنشئ قاعدة جديدة للرد التلقائي على الرسائل
                    </Typography>
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={handleOpenCreate}>
                        إنشاء أول قاعدة
                    </Button>
                </Paper>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.50' }}>
                                <TableCell width={50}>الأولوية</TableCell>
                                <TableCell>الحالة</TableCell>
                                <TableCell>الاسم</TableCell>
                                <TableCell>النوع</TableCell>
                                <TableCell>القناة</TableCell>
                                <TableCell>العميل</TableCell>
                                <TableCell>التشغيلات</TableCell>
                                <TableCell>التهدئة</TableCell>
                                <TableCell width={120}>إجراءات</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rules.map(rule => (
                                <TableRow key={rule.id} sx={{ '&:hover': { bgcolor: 'grey.50' } }}>
                                    <TableCell>
                                        <Chip label={rule.priority} size="small" variant="outlined" sx={{ fontWeight: 'bold' }} />
                                    </TableCell>
                                    <TableCell>
                                        <Switch
                                            checked={!!rule.is_active}
                                            onChange={() => handleToggle(rule.id)}
                                            size="small"
                                            color="success"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="subtitle2" fontWeight="bold">{rule.name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {rule.rule_type === 'keyword' && `${rule.match_type === 'exact' ? 'مطابقة:' : rule.match_type === 'contains' ? 'يحتوي:' : 'regex:'} ${rule.match_pattern}`}
                                            {rule.rule_type === 'welcome' && 'أول رسالة من جهة اتصال جديدة'}
                                            {rule.rule_type === 'away' && `${rule.schedule_start_time} - ${rule.schedule_end_time}`}
                                            {rule.rule_type === 'comment_reply' && (
                                                `${rule.trigger_on === 'reaction' ? 'تفاعلات' : rule.trigger_on === 'both' ? 'تعليقات+تفاعلات' : 'تعليقات'} • ${rule.target_post_id ? 'منشور محدد' : 'جميع المنشورات'} • ${rule.response_action === 'comment' ? 'رد عام' : rule.response_action === 'dm' ? 'رسالة خاصة' : 'رد + DM'}${rule.match_pattern ? ` • ${rule.match_pattern}` : ''}`
                                            )}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            icon={getRuleTypeIcon(rule.rule_type)}
                                            label={getRuleTypeLabel(rule.rule_type)}
                                            size="small"
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>{getChannelChip(rule.channel)}</TableCell>
                                    <TableCell>
                                        <Typography variant="body2">
                                            {rule.tenant_name || 'عام'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" fontWeight="bold">{rule.trigger_count || 0}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption">{formatCooldown(rule.cooldown_seconds)}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title="تعديل">
                                            <IconButton size="small" onClick={() => handleOpenEdit(rule)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="حذف">
                                            <IconButton size="small" color="error" onClick={() => setDeleteConfirm(rule)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Test Panel */}
            <Paper sx={{ p: 3, mt: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <ScienceIcon color="primary" />
                    <Typography variant="h6">اختبار القواعد</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                        <InputLabel>القناة</InputLabel>
                        <Select value={testChannel} onChange={e => setTestChannel(e.target.value)} label="القناة">
                            <MenuItem value="whatsapp">واتساب</MenuItem>
                            <MenuItem value="messenger">ماسنجر</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>العميل</InputLabel>
                        <Select value={testTenantId} onChange={e => setTestTenantId(e.target.value)} label="العميل">
                            <MenuItem value="">عام (بدون عميل)</MenuItem>
                            {tenants.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField
                        size="small"
                        label="نص الرسالة"
                        value={testMessage}
                        onChange={e => setTestMessage(e.target.value)}
                        sx={{ flex: 1, minWidth: 200 }}
                    />
                    <FormControlLabel
                        control={<Checkbox checked={testNewContact} onChange={e => setTestNewContact(e.target.checked)} size="small" />}
                        label="جهة اتصال جديدة"
                    />
                    <Button
                        variant="contained"
                        startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TestIcon />}
                        onClick={handleTest}
                        disabled={testing || (!testMessage && !testNewContact)}
                    >
                        اختبار
                    </Button>
                </Box>
                {testResult && (
                    <Box sx={{ mt: 2 }}>
                        {testResult.error ? (
                            <Alert severity="error">{testResult.error}</Alert>
                        ) : testResult.would_match ? (
                            <Alert severity="success" icon={<CheckCircleIcon />}>
                                <Typography variant="subtitle2">
                                    ستطابق: "{testResult.rule.name}" (أولوية {testResult.rule.priority})
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.8 }}>
                                    الرد: {testResult.response_text?.substring(0, 150)}
                                    {testResult.response_text?.length > 150 ? '...' : ''}
                                </Typography>
                            </Alert>
                        ) : (
                            <Alert severity="info" icon={<CancelIcon />}>
                                لا توجد قاعدة مطابقة لهذه الرسالة
                            </Alert>
                        )}
                    </Box>
                )}
            </Paper>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {editingRule ? `تعديل: ${editingRule.name}` : 'إنشاء قاعدة جديدة'}
                </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                        {/* Basic info */}
                        <TextField
                            label="اسم القاعدة"
                            value={formData.name}
                            onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                            required
                            fullWidth
                        />

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel>نوع القاعدة</InputLabel>
                                <Select
                                    value={formData.rule_type}
                                    onChange={e => setFormData(p => ({ ...p, rule_type: e.target.value }))}
                                    label="نوع القاعدة"
                                    disabled={!!editingRule}
                                >
                                    {RULE_TYPES.map(t => (
                                        <MenuItem key={t.value} value={t.value}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {t.icon} {t.label}
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth>
                                <InputLabel>القناة</InputLabel>
                                <Select
                                    value={formData.channel}
                                    onChange={e => setFormData(p => ({ ...p, channel: e.target.value }))}
                                    label="القناة"
                                >
                                    {CHANNELS.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel>العميل</InputLabel>
                                <Select
                                    value={formData.tenant_id}
                                    onChange={e => setFormData(p => ({ ...p, tenant_id: e.target.value }))}
                                    label="العميل"
                                >
                                    <MenuItem value="">عام (جميع العملاء)</MenuItem>
                                    {tenants.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <TextField
                                label="الأولوية"
                                type="number"
                                value={formData.priority}
                                onChange={e => setFormData(p => ({ ...p, priority: parseInt(e.target.value) || 100 }))}
                                helperText="أقل = أعلى أولوية"
                                sx={{ minWidth: 120 }}
                            />
                        </Box>

                        <Divider />

                        {/* Keyword-specific fields */}
                        {formData.rule_type === 'keyword' && (
                            <>
                                <Typography variant="subtitle2" color="primary">إعدادات الكلمة المفتاحية</Typography>
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <FormControl sx={{ minWidth: 160 }}>
                                        <InputLabel>نوع المطابقة</InputLabel>
                                        <Select
                                            value={formData.match_type}
                                            onChange={e => setFormData(p => ({ ...p, match_type: e.target.value }))}
                                            label="نوع المطابقة"
                                        >
                                            {MATCH_TYPES.map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        label={formData.match_type === 'contains' ? 'الكلمات (فاصلة بين كل كلمة)' : 'النمط'}
                                        value={formData.match_pattern}
                                        onChange={e => setFormData(p => ({ ...p, match_pattern: e.target.value }))}
                                        fullWidth
                                        placeholder={formData.match_type === 'contains' ? 'سعر,أسعار,كم السعر' : ''}
                                    />
                                </Box>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={formData.match_case_sensitive}
                                            onChange={e => setFormData(p => ({ ...p, match_case_sensitive: e.target.checked }))}
                                        />
                                    }
                                    label="حساسية لحالة الأحرف"
                                />
                            </>
                        )}

                        {/* Welcome info */}
                        {formData.rule_type === 'welcome' && (
                            <Alert severity="info">
                                سيتم إرسال هذا الرد تلقائياً عند استقبال أول رسالة من جهة اتصال جديدة
                            </Alert>
                        )}

                        {/* Away-specific fields */}
                        {formData.rule_type === 'away' && (
                            <>
                                <Typography variant="subtitle2" color="primary">جدول خارج الدوام</Typography>
                                <FormGroup row>
                                    {DAY_OPTIONS.map(day => (
                                        <FormControlLabel
                                            key={day.value}
                                            control={
                                                <Checkbox
                                                    checked={formData.schedule_days.includes(day.value)}
                                                    onChange={e => {
                                                        setFormData(p => ({
                                                            ...p,
                                                            schedule_days: e.target.checked
                                                                ? [...p.schedule_days, day.value]
                                                                : p.schedule_days.filter(d => d !== day.value)
                                                        }));
                                                    }}
                                                    size="small"
                                                />
                                            }
                                            label={day.label}
                                        />
                                    ))}
                                </FormGroup>
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <TextField
                                        label="بداية (خارج الدوام)"
                                        type="time"
                                        value={formData.schedule_start_time}
                                        onChange={e => setFormData(p => ({ ...p, schedule_start_time: e.target.value }))}
                                        InputLabelProps={{ shrink: true }}
                                        fullWidth
                                    />
                                    <TextField
                                        label="نهاية (خارج الدوام)"
                                        type="time"
                                        value={formData.schedule_end_time}
                                        onChange={e => setFormData(p => ({ ...p, schedule_end_time: e.target.value }))}
                                        InputLabelProps={{ shrink: true }}
                                        fullWidth
                                    />
                                </Box>
                                <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                                    مثال: 20:00 إلى 08:00 = الرد يعمل من الثامنة مساءً إلى الثامنة صباحاً
                                </Alert>
                            </>
                        )}

                        {/* Comment Reply-specific fields */}
                        {formData.rule_type === 'comment_reply' && (
                            <>
                                <Typography variant="subtitle2" color="primary">إعدادات الرد على التعليقات</Typography>
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <FormControl fullWidth>
                                        <InputLabel>الصفحة</InputLabel>
                                        <Select
                                            value={formData.target_page_id}
                                            onChange={e => {
                                                const pageId = e.target.value;
                                                setFormData(p => ({ ...p, target_page_id: pageId, target_post_id: '' }));
                                                fetchPostsForPage(pageId);
                                            }}
                                            label="الصفحة"
                                        >
                                            <MenuItem value="">جميع الصفحات</MenuItem>
                                            {fbPages.map(p => (
                                                <MenuItem key={p.id} value={p.id}>{p.page_name || p.page_id}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <FormControl fullWidth>
                                        <InputLabel>المنشور</InputLabel>
                                        <Select
                                            value={formData.target_post_id}
                                            onChange={e => setFormData(p => ({ ...p, target_post_id: e.target.value }))}
                                            label="المنشور"
                                            disabled={!formData.target_page_id || postsLoading}
                                        >
                                            <MenuItem value="">جميع المنشورات</MenuItem>
                                            {fbPosts.map(post => (
                                                <MenuItem key={post.id} value={post.id}>
                                                    {(post.message || 'بدون نص').substring(0, 60)}{(post.message || '').length > 60 ? '...' : ''}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Box>

                                {/* Keyword matching (optional for comment_reply) */}
                                <Typography variant="subtitle2" color="primary" sx={{ mt: 1 }}>مطابقة الكلمات (اختياري)</Typography>
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <FormControl sx={{ minWidth: 160 }}>
                                        <InputLabel>نوع المطابقة</InputLabel>
                                        <Select
                                            value={formData.match_type}
                                            onChange={e => setFormData(p => ({ ...p, match_type: e.target.value }))}
                                            label="نوع المطابقة"
                                        >
                                            {MATCH_TYPES.map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        label="الكلمات (اتركه فارغاً للرد على الكل)"
                                        value={formData.match_pattern}
                                        onChange={e => setFormData(p => ({ ...p, match_pattern: e.target.value }))}
                                        fullWidth
                                        placeholder="مثال: سعر,تفاصيل,كم — اتركه فارغاً للرد على كل تعليق"
                                    />
                                </Box>
                                <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                                    اترك حقل الكلمات فارغاً للرد على جميع التعليقات. أو اكتب كلمات مفتاحية مفصولة بفاصلة للرد فقط على التعليقات المطابقة.
                                </Alert>

                                {/* Response Action */}
                                <Typography variant="subtitle2" color="primary" sx={{ mt: 1 }}>مشغل القاعدة</Typography>
                                <RadioGroup
                                    row
                                    value={formData.trigger_on}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setFormData(p => ({
                                            ...p,
                                            trigger_on: val,
                                            // Reactions can only send DMs
                                            response_action: val === 'reaction' ? 'dm' : p.response_action,
                                        }));
                                    }}
                                >
                                    {TRIGGER_ON_OPTIONS.map(t => (
                                        <FormControlLabel key={t.value} value={t.value} control={<Radio />} label={t.label} />
                                    ))}
                                </RadioGroup>

                                {formData.trigger_on === 'reaction' && (
                                    <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
                                        التفاعلات (إعجاب/قلب/هاها...) يمكنها فقط إرسال رسالة خاصة (DM).
                                        يمكنك تحديد نوع التفاعل في حقل الكلمات (مثل: like,love,haha).
                                    </Alert>
                                )}

                                <Typography variant="subtitle2" color="primary" sx={{ mt: 1 }}>نوع الرد</Typography>
                                <RadioGroup
                                    row
                                    value={formData.response_action}
                                    onChange={e => setFormData(p => ({ ...p, response_action: e.target.value }))}
                                >
                                    {RESPONSE_ACTIONS.map(a => (
                                        <FormControlLabel
                                            key={a.value}
                                            value={a.value}
                                            control={<Radio />}
                                            label={a.label}
                                            disabled={formData.trigger_on === 'reaction' && a.value === 'comment'}
                                        />
                                    ))}
                                </RadioGroup>
                            </>
                        )}

                        <Divider />

                        {/* Response */}
                        <Typography variant="subtitle2" color="primary">
                            {formData.rule_type === 'comment_reply' && (formData.response_action === 'comment' || formData.response_action === 'both')
                                ? 'نص الرد العام (تعليق)'
                                : 'الرد التلقائي'}
                        </Typography>
                        {(formData.rule_type !== 'comment_reply' || formData.response_action === 'comment' || formData.response_action === 'both') && (
                            <TextField
                                label={formData.rule_type === 'comment_reply' ? 'نص التعليق العام' : 'نص الرد'}
                                value={formData.response_text}
                                onChange={e => setFormData(p => ({ ...p, response_text: e.target.value }))}
                                multiline
                                rows={3}
                                required={formData.rule_type !== 'comment_reply'}
                                fullWidth
                                placeholder="اكتب الرد التلقائي هنا..."
                            />
                        )}

                        {/* DM text for comment_reply */}
                        {formData.rule_type === 'comment_reply' && (formData.response_action === 'dm' || formData.response_action === 'both') && (
                            <TextField
                                label="نص الرسالة الخاصة (DM)"
                                value={formData.dm_text}
                                onChange={e => setFormData(p => ({ ...p, dm_text: e.target.value }))}
                                multiline
                                rows={3}
                                fullWidth
                                placeholder="الرسالة الخاصة التي ستُرسل للمعلق..."
                            />
                        )}

                        <TextField
                            label="فترة التهدئة (بالثواني)"
                            type="number"
                            value={formData.cooldown_seconds}
                            onChange={e => setFormData(p => ({ ...p, cooldown_seconds: parseInt(e.target.value) || 0 }))}
                            helperText={`= ${formatCooldown(formData.cooldown_seconds)} — لن يتكرر الرد لنفس جهة الاتصال خلال هذه الفترة`}
                            fullWidth
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>إلغاء</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={saving || !formData.name || (
                            formData.rule_type === 'comment_reply'
                                ? (!formData.response_text && !formData.dm_text)
                                : !formData.response_text
                        )}
                        startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
                    >
                        {saving ? 'جاري الحفظ...' : editingRule ? 'تحديث' : 'إنشاء'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
                <DialogTitle>حذف القاعدة</DialogTitle>
                <DialogContent>
                    <Typography>هل أنت متأكد من حذف "{deleteConfirm?.name}"؟</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        هذا الإجراء لا يمكن التراجع عنه.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirm(null)}>إلغاء</Button>
                    <Button variant="contained" color="error" onClick={() => handleDelete(deleteConfirm.id)}>
                        حذف
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AutomationManager;
