import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    Alert,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Stepper,
    Step,
    StepLabel,
    Card,
    CardContent,
    Divider,
    LinearProgress
} from '@mui/material';
import {
    Campaign as CampaignIcon,
    Send as SendIcon,
    People as PeopleIcon,
    Description as TemplateIcon,
    CheckCircle as SuccessIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import api from '../../api';

const BroadcastManager = () => {
    const [activeStep, setActiveStep] = useState(0);
    const [tenants, setTenants] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [recipientsText, setRecipientsText] = useState('');
    const [templateLanguage, setTemplateLanguage] = useState('ar');

    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadTenants = async () => {
            try {
                const data = await api.getTenants();
                setTenants(data);
            } catch (err) {
                console.error('Failed to load tenants:', err);
            }
        };
        loadTenants();
    }, []);

    useEffect(() => {
        if (!selectedTenantId) {
            setTemplates([]);
            setSelectedTemplate(null);
            return;
        }
        const loadTemplates = async () => {
            try {
                const data = await api.getAdminTemplates(selectedTenantId);
                setTemplates(data || []);
            } catch (err) {
                console.error('Failed to load templates:', err);
                setTemplates([]);
            }
        };
        loadTemplates();
    }, [selectedTenantId]);

    const recipients = recipientsText
        .split(/[\n,;]+/)
        .map(r => r.replace(/[^0-9+]/g, '').trim())
        .filter(r => r.length >= 8);

    const uniqueRecipients = [...new Set(recipients)];

    const selectedTenant = tenants.find(t => t.id === parseInt(selectedTenantId));

    const canProceedStep0 = selectedTenantId && selectedTemplate;
    const canProceedStep1 = uniqueRecipients.length > 0 && uniqueRecipients.length <= 500;

    const handleSend = async () => {
        if (!selectedTenantId || !selectedTemplate || uniqueRecipients.length === 0) return;

        try {
            setSending(true);
            setError(null);
            setResults(null);

            const data = await api.broadcastMessage({
                tenant_id: parseInt(selectedTenantId),
                recipients: uniqueRecipients,
                template_name: selectedTemplate.name,
                template_language: templateLanguage,
            });

            setResults(data);
            setActiveStep(3);
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    const handleReset = () => {
        setActiveStep(0);
        setSelectedTenantId('');
        setSelectedTemplate(null);
        setRecipientsText('');
        setResults(null);
        setError(null);
    };

    const steps = ['اختيار القالب', 'إدخال المستلمين', 'مراجعة وإرسال', 'النتائج'];

    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CampaignIcon fontSize="large" color="primary" />
                    البث الجماعي
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إرسال قوالب رسائل إلى مجموعة من المستلمين دفعة واحدة
                </Typography>
            </Box>

            {/* Stepper */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stepper activeStep={activeStep} alternativeLabel>
                    {steps.map((label) => (
                        <Step key={label}>
                            <StepLabel>{label}</StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Paper>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {/* Step 0: Select tenant & template */}
            {activeStep === 0 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        اختيار العميل والقالب
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
                        <FormControl fullWidth>
                            <InputLabel>العميل</InputLabel>
                            <Select
                                value={selectedTenantId}
                                label="العميل"
                                onChange={(e) => {
                                    setSelectedTenantId(e.target.value);
                                    setSelectedTemplate(null);
                                }}
                            >
                                {tenants.map(t => (
                                    <MenuItem key={t.id} value={t.id}>
                                        {t.name} — رصيد: {t.credits?.toLocaleString() || 0}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {templates.length > 0 && (
                            <FormControl fullWidth>
                                <InputLabel>القالب</InputLabel>
                                <Select
                                    value={selectedTemplate?.id || ''}
                                    label="القالب"
                                    onChange={(e) => {
                                        const tmpl = templates.find(t => t.id === e.target.value);
                                        setSelectedTemplate(tmpl);
                                    }}
                                >
                                    {templates.filter(t => t.status === 'approved').map(t => (
                                        <MenuItem key={t.id} value={t.id}>
                                            {t.name} ({t.language || 'ar'})
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        {selectedTemplate && (
                            <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        معاينة القالب
                                    </Typography>
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
                                        {selectedTemplate.body || 'لا يوجد محتوى'}
                                    </Typography>
                                    {selectedTemplate.footer && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                            {selectedTemplate.footer}
                                        </Typography>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <FormControl fullWidth size="small">
                            <InputLabel>اللغة</InputLabel>
                            <Select value={templateLanguage} label="اللغة" onChange={(e) => setTemplateLanguage(e.target.value)}>
                                <MenuItem value="ar">العربية</MenuItem>
                                <MenuItem value="en">English</MenuItem>
                                <MenuItem value="en_US">English (US)</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            variant="contained"
                            disabled={!canProceedStep0}
                            onClick={() => setActiveStep(1)}
                        >
                            التالي
                        </Button>
                    </Box>
                </Paper>
            )}

            {/* Step 1: Enter recipients */}
            {activeStep === 1 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        إدخال أرقام المستلمين
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        أدخل أرقام الهواتف — رقم واحد لكل سطر. الحد الأقصى 500 رقم.
                    </Typography>

                    <TextField
                        fullWidth
                        multiline
                        rows={10}
                        placeholder={"218911234567\n218921234567\n+218931234567"}
                        value={recipientsText}
                        onChange={(e) => setRecipientsText(e.target.value)}
                        sx={{ fontFamily: 'monospace' }}
                    />

                    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Chip
                            icon={<PeopleIcon />}
                            label={`${uniqueRecipients.length} مستلم`}
                            color={uniqueRecipients.length > 500 ? 'error' : uniqueRecipients.length > 0 ? 'primary' : 'default'}
                        />
                        {uniqueRecipients.length > 500 && (
                            <Alert severity="error" sx={{ flex: 1 }}>
                                الحد الأقصى 500 مستلم لكل عملية بث
                            </Alert>
                        )}
                        {selectedTenant && selectedTenant.credits !== null && selectedTenant.credits < uniqueRecipients.length && (
                            <Alert severity="warning" sx={{ flex: 1 }}>
                                رصيد العميل ({selectedTenant.credits}) أقل من عدد المستلمين ({uniqueRecipients.length})
                            </Alert>
                        )}
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(0)}>السابق</Button>
                        <Button
                            variant="contained"
                            disabled={!canProceedStep1}
                            onClick={() => setActiveStep(2)}
                        >
                            التالي
                        </Button>
                    </Box>
                </Paper>
            )}

            {/* Step 2: Review & Send */}
            {activeStep === 2 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        مراجعة وتأكيد الإرسال
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            <Card variant="outlined" sx={{ flex: 1, minWidth: 200 }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">العميل</Typography>
                                    <Typography variant="h6">{selectedTenant?.name}</Typography>
                                </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ flex: 1, minWidth: 200 }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">القالب</Typography>
                                    <Typography variant="h6">{selectedTemplate?.name}</Typography>
                                </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ flex: 1, minWidth: 200 }}>
                                <CardContent>
                                    <Typography variant="caption" color="text.secondary">عدد المستلمين</Typography>
                                    <Typography variant="h6">{uniqueRecipients.length}</Typography>
                                </CardContent>
                            </Card>
                        </Box>

                        <Divider />

                        <Alert severity="info">
                            سيتم إرسال الرسائل بمعدل ~10 رسائل/ثانية. الوقت المقدر: ~{Math.ceil(uniqueRecipients.length / 10)} ثانية.
                        </Alert>
                    </Box>

                    {sending && (
                        <Box sx={{ mt: 3 }}>
                            <LinearProgress />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                                جاري إرسال الرسائل... يرجى عدم إغلاق الصفحة
                            </Typography>
                        </Box>
                    )}

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(1)} disabled={sending}>السابق</Button>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                            onClick={handleSend}
                            disabled={sending}
                            size="large"
                        >
                            {sending ? 'جاري الإرسال...' : `إرسال إلى ${uniqueRecipients.length} مستلم`}
                        </Button>
                    </Box>
                </Paper>
            )}

            {/* Step 3: Results */}
            {activeStep === 3 && results && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        نتائج البث
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} color="text.primary">
                                    {results.total}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">إجمالي</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} color="success.main">
                                    {results.sent}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">نجاح</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} color="error.main">
                                    {results.failed}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">فشل</Typography>
                            </CardContent>
                        </Card>
                    </Box>

                    {results.results && results.results.length > 0 && (
                        <TableContainer sx={{ maxHeight: 400 }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>المستلم</TableCell>
                                        <TableCell>الحالة</TableCell>
                                        <TableCell>التفاصيل</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {results.results.map((r, i) => (
                                        <TableRow key={i}>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>{r.recipient}</TableCell>
                                            <TableCell>
                                                {r.status === 'sent' ? (
                                                    <Chip icon={<SuccessIcon />} label="نجاح" color="success" size="small" />
                                                ) : (
                                                    <Chip icon={<ErrorIcon />} label="فشل" color="error" size="small" />
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {r.message_id || r.error || '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                        <Button variant="contained" onClick={handleReset}>
                            بث جديد
                        </Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default BroadcastManager;
