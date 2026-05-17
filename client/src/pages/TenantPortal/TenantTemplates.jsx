import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    Alert,
    Tooltip,
    Tab,
    Tabs,
    Paper
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    ContentCopy as CopyIcon,
    Sync as SyncIcon,
    Check as CheckIcon,
    Close as CloseIcon,
    Schedule as ScheduleIcon,
    CloudUpload as CloudUploadIcon
} from '@mui/icons-material';
import api from '../../api';

const TenantTemplates = () => {
    const [templates, setTemplates] = useState([]);
    const [metaTemplates, setMetaTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [submittingToMeta, setSubmittingToMeta] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [tabValue, setTabValue] = useState(0);

    const [formData, setFormData] = useState({
        name: '',
        language: 'ar',
        category: 'UTILITY',
        header_type: 'none',
        header_content: '',
        body: '',
        footer: '',
    });

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.getPortalTemplates();
            setTemplates(data);
        } catch (err) {
            console.error('Failed to fetch templates:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const syncFromMeta = async () => {
        try {
            setSyncing(true);
            setError(null);
            const result = await api.syncPortalTemplates();
            setMetaTemplates(result.templates || []);
            // Refresh templates list after sync - they're now in database
            fetchTemplates();
            setSuccess(`تم مزامنة ${result.synced || 0} قالب (${result.created || 0} جديد، ${result.updated || 0} محدث)`);
        } catch (err) {
            console.error('Failed to sync from Meta:', err);
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    const importTemplate = async (metaTemplate) => {
        try {
            await api.importPortalTemplate(metaTemplate);
            setSuccess(`تم استيراد القالب "${metaTemplate.name}" بنجاح`);
            fetchTemplates();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleOpenDialog = (template = null) => {
        if (template) {
            setSelectedTemplate(template);
            setFormData({
                name: template.name,
                language: template.language || 'ar',
                category: template.category || 'UTILITY',
                header_type: template.header_type || 'none',
                header_content: template.header_content || '',
                body: template.body,
                footer: template.footer || '',
            });
        } else {
            setSelectedTemplate(null);
            setFormData({
                name: '',
                language: 'ar',
                category: 'UTILITY',
                header_type: 'none',
                header_content: '',
                body: '',
                footer: '',
            });
        }
        setDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
        setSelectedTemplate(null);
    };

    const handleSave = async () => {
        if (!formData.name || !formData.body) {
            setError('اسم القالب والمحتوى مطلوبان');
            return;
        }

        try {
            setSaving(true);
            setError(null);

            if (selectedTemplate) {
                await api.updatePortalTemplate(selectedTemplate.id, formData);
            } else {
                await api.createPortalTemplate(formData);
            }

            handleCloseDialog();
            fetchTemplates();
            setSuccess(selectedTemplate ? 'تم تحديث القالب بنجاح' : 'تم إنشاء القالب بنجاح');
        } catch (err) {
            console.error('Failed to save template:', err);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedTemplate) return;

        try {
            setSaving(true);
            await api.deletePortalTemplate(selectedTemplate.id);
            setDeleteDialogOpen(false);
            setSelectedTemplate(null);
            fetchTemplates();
            setSuccess('تم حذف القالب بنجاح');
        } catch (err) {
            console.error('Failed to delete template:', err);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const openDeleteDialog = (template) => {
        setSelectedTemplate(template);
        setDeleteDialogOpen(true);
    };

    // Build Meta components array from form data
    const buildMetaComponents = (data) => {
        const components = [];

        if (data.header_type && data.header_type !== 'none') {
            const header = { type: 'HEADER' };
            if (data.header_type === 'text') {
                header.format = 'TEXT';
                header.text = data.header_content || '';
                const headerVars = (data.header_content || '').match(/\{\{[^}]+\}\}/g);
                if (headerVars) {
                    header.example = { header_text: headerVars.map(() => 'مثال') };
                }
            } else if (data.header_type === 'location') {
                header.format = 'LOCATION';
            } else {
                header.format = data.header_type.toUpperCase();
            }
            components.push(header);
        }

        const bodyComp = { type: 'BODY', text: data.body };
        const bodyVars = (data.body || '').match(/\{\{[^}]+\}\}/g);
        if (bodyVars) {
            bodyComp.example = { body_text: [bodyVars.map(() => 'مثال')] };
        }
        components.push(bodyComp);

        if (data.footer) {
            components.push({ type: 'FOOTER', text: data.footer });
        }

        return components;
    };

    const handleSubmitToMeta = async (data = null) => {
        const templateData = data || formData;
        if (!templateData.name || !templateData.body) {
            setError('اسم القالب والمحتوى مطلوبان');
            return;
        }

        try {
            setSubmittingToMeta(true);
            setError(null);

            const components = buildMetaComponents(templateData);

            await api.createPortalTemplateMeta({
                name: templateData.name,
                language: templateData.language || 'ar',
                category: templateData.category || 'UTILITY',
                parameter_format: 'positional',
                components,
            });

            handleCloseDialog();
            setSuccess(`تم رفع القالب "${templateData.name}" إلى WhatsApp بنجاح. سيتم مراجعته من Meta.`);

            try {
                await api.syncPortalTemplates();
            } catch (_) { /* silent */ }
            fetchTemplates();
        } catch (err) {
            console.error('Failed to submit template to Meta:', err);
            setError(err.message || 'فشل رفع القالب إلى WhatsApp');
        } finally {
            setSubmittingToMeta(false);
        }
    };

    const handleDeleteFromMeta = async (template) => {
        if (!confirm(`هل أنت متأكد من حذف القالب "${template.name}" من WhatsApp؟`)) return;
        try {
            await api.deletePortalTemplateMeta(template.name);
            setSuccess(`تم حذف القالب "${template.name}" من WhatsApp`);
            fetchTemplates();
        } catch (err) {
            setError(err.message);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const getStatusChip = (status) => {
        const statusConfig = {
            draft: { label: 'مسودة', color: 'default', icon: <EditIcon fontSize="small" /> },
            pending: { label: 'قيد المراجعة', color: 'warning', icon: <ScheduleIcon fontSize="small" /> },
            approved: { label: 'معتمد', color: 'success', icon: <CheckIcon fontSize="small" /> },
            rejected: { label: 'مرفوض', color: 'error', icon: <CloseIcon fontSize="small" /> },
            paused: { label: 'متوقف', color: 'warning', icon: <ScheduleIcon fontSize="small" /> },
            disabled: { label: 'معطل', color: 'default', icon: <CloseIcon fontSize="small" /> },
            in_appeal: { label: 'قيد الاستئناف', color: 'warning', icon: <ScheduleIcon fontSize="small" /> },
            pending_deletion: { label: 'بانتظار الحذف', color: 'error', icon: <CloseIcon fontSize="small" /> },
            deleted: { label: 'محذوف', color: 'error', icon: <CloseIcon fontSize="small" /> },
            limit_exceeded: { label: 'تجاوز الحد', color: 'error', icon: <CloseIcon fontSize="small" /> },
            APPROVED: { label: 'معتمد', color: 'success', icon: <CheckIcon fontSize="small" /> },
            PENDING: { label: 'قيد المراجعة', color: 'warning', icon: <ScheduleIcon fontSize="small" /> },
            REJECTED: { label: 'مرفوض', color: 'error', icon: <CloseIcon fontSize="small" /> },
        };
        const config = statusConfig[status] || statusConfig.draft;
        return <Chip label={config.label} color={config.color} size="small" icon={config.icon} />;
    };

    const getQualityChip = (qualityScore) => {
        if (!qualityScore || qualityScore === 'UNKNOWN') return null;
        const config = {
            HIGH: { label: 'جودة عالية', color: 'success' },
            MEDIUM: { label: 'جودة متوسطة', color: 'warning' },
            LOW: { label: 'جودة منخفضة', color: 'error' },
        };
        const q = config[qualityScore] || config[qualityScore.toUpperCase()];
        if (!q) return null;
        return <Chip label={q.label} color={q.color} size="small" variant="outlined" sx={{ ml: 0.5 }} />;
    };

    const getCategoryLabel = (category) => {
        const categories = {
            'UTILITY': 'خدمي',
            'MARKETING': 'تسويقي',
            'AUTHENTICATION': 'تحقق',
        };
        return categories[category] || category;
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 4, gap: { xs: 1, md: 0 } }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        القوالب
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        إدارة قوالب الرسائل الخاصة بك
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: { xs: 1, md: 2 }, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                    <Button
                        variant="outlined"
                        startIcon={syncing ? <CircularProgress size={20} /> : <SyncIcon />}
                        onClick={syncFromMeta}
                        disabled={syncing}
                    >
                        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>مزامنة من WhatsApp</Box>
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        onClick={fetchTemplates}
                        disabled={loading}
                    >
                        تحديث
                    </Button>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => handleOpenDialog()}
                    >
                        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>قالب جديد</Box>
                    </Button>
                </Box>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {success && (
                <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
                    {success}
                </Alert>
            )}

            {/* Tabs */}
            <Paper sx={{ mb: 3 }}>
                <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
                    <Tab label={`القوالب المحلية (${templates.length})`} />
                    <Tab label={`قوالب WhatsApp (${metaTemplates.length})`} />
                </Tabs>
            </Paper>

            {/* Local Templates */}
            {tabValue === 0 && (
                <Card elevation={2}>
                    {loading ? (
                        <Box sx={{ p: 4, textAlign: 'center' }}>
                            <CircularProgress />
                        </Box>
                    ) : templates.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            <Typography variant="h6" gutterBottom>لا توجد قوالب</Typography>
                            <Typography variant="body2">
                                ابدأ بإنشاء قالب جديد أو مزامنة من WhatsApp
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 2 }}>
                                <Button
                                    variant="outlined"
                                    startIcon={<SyncIcon />}
                                    onClick={syncFromMeta}
                                    disabled={syncing}
                                >
                                    مزامنة من WhatsApp
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleOpenDialog()}
                                >
                                    إنشاء قالب
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الاسم</TableCell>
                                        <TableCell>الفئة</TableCell>
                                        <TableCell>اللغة</TableCell>
                                        <TableCell>الحالة</TableCell>
                                        <TableCell>الجودة</TableCell>
                                        <TableCell>تاريخ الإنشاء</TableCell>
                                        <TableCell align="center">الإجراءات</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {templates.map((template) => (
                                        <TableRow key={template.id} hover>
                                            <TableCell>
                                                <Typography fontWeight={500}>{template.name}</Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{
                                                    display: 'block',
                                                    maxWidth: 300,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {template.body}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>{getCategoryLabel(template.category)}</TableCell>
                                            <TableCell><Chip label={template.language?.toUpperCase()} size="small" variant="outlined" /></TableCell>
                                            <TableCell>{getStatusChip(template.status)}</TableCell>
                                            <TableCell>{getQualityChip(template.quality_score)}</TableCell>
                                            <TableCell>
                                                {new Date(template.created_at).toLocaleDateString('ar-LY')}
                                            </TableCell>
                                            <TableCell align="center">
                                                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                                    {(!template.meta_template_id && template.status === 'draft') && (
                                                        <Tooltip title="رفع إلى WhatsApp">
                                                            <IconButton
                                                                size="small"
                                                                color="primary"
                                                                onClick={() => handleSubmitToMeta(template)}
                                                                disabled={submittingToMeta}
                                                            >
                                                                <CloudUploadIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                    <Tooltip title="نسخ المحتوى">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => copyToClipboard(template.body)}
                                                        >
                                                            <CopyIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="تعديل">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => handleOpenDialog(template)}
                                                        >
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="حذف">
                                                        <IconButton
                                                            size="small"
                                                            color="error"
                                                            onClick={() => openDeleteDialog(template)}
                                                        >
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    {template.meta_template_id && (
                                                        <Tooltip title="حذف من WhatsApp">
                                                            <IconButton
                                                                size="small"
                                                                color="error"
                                                                onClick={() => handleDeleteFromMeta(template)}
                                                            >
                                                                <CloseIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Card>
            )}

            {/* Meta Templates */}
            {tabValue === 1 && (
                <Card elevation={2}>
                    {metaTemplates.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            <Typography variant="h6" gutterBottom>لا توجد قوالب من WhatsApp</Typography>
                            <Typography variant="body2">
                                اضغط على "مزامنة من WhatsApp" لجلب القوالب المعتمدة
                            </Typography>
                            <Button
                                variant="outlined"
                                startIcon={syncing ? <CircularProgress size={20} /> : <SyncIcon />}
                                onClick={syncFromMeta}
                                disabled={syncing}
                                sx={{ mt: 2 }}
                            >
                                مزامنة من WhatsApp
                            </Button>
                        </Box>
                    ) : (
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الاسم</TableCell>
                                        <TableCell>الفئة</TableCell>
                                        <TableCell>اللغة</TableCell>
                                        <TableCell>الحالة</TableCell>
                                        <TableCell align="center">الإجراءات</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {metaTemplates.map((template, idx) => (
                                        <TableRow key={template.id || idx} hover>
                                            <TableCell>
                                                <Typography fontWeight={500}>{template.name}</Typography>
                                            </TableCell>
                                            <TableCell>{getCategoryLabel(template.category)}</TableCell>
                                            <TableCell>{template.language?.toUpperCase()}</TableCell>
                                            <TableCell>{getStatusChip(template.status)}</TableCell>
                                            <TableCell align="center">
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() => importTemplate(template)}
                                                >
                                                    استيراد
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Card>
            )}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
                <DialogTitle>
                    {selectedTemplate ? 'تعديل القالب' : 'إنشاء قالب جديد'}
                </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
                        <TextField
                            label="اسم القالب"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            fullWidth
                            required
                            placeholder="مثال: رسالة_ترحيب"
                        />

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel>الفئة</InputLabel>
                                <Select
                                    value={formData.category}
                                    label="الفئة"
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    <MenuItem value="UTILITY">خدمي</MenuItem>
                                    <MenuItem value="MARKETING">تسويقي</MenuItem>
                                    <MenuItem value="AUTHENTICATION">تحقق</MenuItem>
                                </Select>
                            </FormControl>

                            <FormControl fullWidth>
                                <InputLabel>اللغة</InputLabel>
                                <Select
                                    value={formData.language}
                                    label="اللغة"
                                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                                >
                                    <MenuItem value="ar">العربية</MenuItem>
                                    <MenuItem value="en">الإنجليزية</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>

                        <FormControl fullWidth>
                            <InputLabel>نوع الرأس</InputLabel>
                            <Select
                                value={formData.header_type}
                                label="نوع الرأس"
                                onChange={(e) => setFormData({ ...formData, header_type: e.target.value })}
                            >
                                <MenuItem value="none">بدون رأس</MenuItem>
                                <MenuItem value="text">نص</MenuItem>
                                <MenuItem value="image">صورة</MenuItem>
                                <MenuItem value="video">فيديو</MenuItem>
                                <MenuItem value="document">مستند</MenuItem>
                                <MenuItem value="location">موقع</MenuItem>
                                <MenuItem value="gif">GIF</MenuItem>
                            </Select>
                        </FormControl>

                        {formData.header_type !== 'none' && (
                            <TextField
                                label={formData.header_type === 'text' ? 'نص الرأس' : 'رابط الوسائط'}
                                value={formData.header_content}
                                onChange={(e) => setFormData({ ...formData, header_content: e.target.value })}
                                fullWidth
                            />
                        )}

                        <TextField
                            label="محتوى الرسالة"
                            value={formData.body}
                            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                            fullWidth
                            required
                            multiline
                            rows={4}
                            placeholder="اكتب محتوى الرسالة هنا..."
                            helperText="يمكنك استخدام {{1}}, {{2}} أو {{variable_name}} للمتغيرات"
                        />

                        <TextField
                            label="تذييل (اختياري)"
                            value={formData.footer}
                            onChange={(e) => setFormData({ ...formData, footer: e.target.value })}
                            fullWidth
                            placeholder="مثال: شركة XYZ - خدمة العملاء"
                        />
                    </Box>
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between' }}>
                    <Button onClick={handleCloseDialog}>إلغاء</Button>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            onClick={handleSave}
                            disabled={saving || submittingToMeta || !formData.name || !formData.body}
                        >
                            {saving ? <CircularProgress size={24} /> : (selectedTemplate ? 'حفظ التغييرات' : 'حفظ كمسودة')}
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={submittingToMeta ? <CircularProgress size={20} /> : <CloudUploadIcon />}
                            onClick={() => handleSubmitToMeta()}
                            disabled={saving || submittingToMeta || !formData.name || !formData.body}
                        >
                            {submittingToMeta ? 'جاري الرفع...' : 'رفع إلى WhatsApp'}
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
                <DialogTitle>تأكيد الحذف</DialogTitle>
                <DialogContent>
                    <Typography>
                        هل أنت متأكد من حذف القالب "{selectedTemplate?.name}"؟
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)}>إلغاء</Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={handleDelete}
                        disabled={saving}
                    >
                        {saving ? <CircularProgress size={24} /> : 'حذف'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantTemplates;
