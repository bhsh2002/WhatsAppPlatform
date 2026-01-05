import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
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
    Tooltip
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    ContentCopy as CopyIcon
} from '@mui/icons-material';
import api from '../../api';

const TenantTemplates = () => {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

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

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const getStatusChip = (status) => {
        const statusConfig = {
            draft: { label: 'مسودة', color: 'default' },
            pending: { label: 'قيد المراجعة', color: 'warning' },
            approved: { label: 'معتمد', color: 'success' },
            rejected: { label: 'مرفوض', color: 'error' },
        };
        const config = statusConfig[status] || statusConfig.draft;
        return <Chip label={config.label} color={config.color} size="small" />;
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
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        القوالب
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        إدارة قوالب الرسائل الخاصة بك
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
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
                        قالب جديد
                    </Button>
                </Box>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Templates Table */}
            <Card elevation={2}>
                {loading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : templates.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography variant="h6" gutterBottom>لا توجد قوالب</Typography>
                        <Typography variant="body2">
                            ابدأ بإنشاء قالب جديد لتسهيل إرسال الرسائل
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => handleOpenDialog()}
                            sx={{ mt: 2 }}
                        >
                            إنشاء قالب
                        </Button>
                    </Box>
                ) : (
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>الاسم</TableCell>
                                    <TableCell>الفئة</TableCell>
                                    <TableCell>اللغة</TableCell>
                                    <TableCell>الحالة</TableCell>
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
                                        <TableCell>{template.language?.toUpperCase()}</TableCell>
                                        <TableCell>{getStatusChip(template.status)}</TableCell>
                                        <TableCell>
                                            {new Date(template.created_at).toLocaleDateString('ar-LY')}
                                        </TableCell>
                                        <TableCell align="center">
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
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Card>

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
                            helperText="يمكنك استخدام {{1}}, {{2}} للمتغيرات"
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
                <DialogActions>
                    <Button onClick={handleCloseDialog}>إلغاء</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={saving || !formData.name || !formData.body}
                    >
                        {saving ? <CircularProgress size={24} /> : (selectedTemplate ? 'حفظ التغييرات' : 'إنشاء')}
                    </Button>
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
