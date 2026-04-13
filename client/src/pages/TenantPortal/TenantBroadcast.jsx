import React, { useState, useEffect, useMemo } from 'react';
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
    LinearProgress,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip
} from '@mui/material';
import {
    Campaign as CampaignIcon,
    Send as SendIcon,
    People as PeopleIcon,
    CheckCircle as SuccessIcon,
    Error as ErrorIcon,
    TextFields as StaticIcon,
    Person as ContactIcon
} from '@mui/icons-material';
import api from '../../api';

// Available contact fields that can be used as dynamic variables
const CONTACT_FIELDS = [
    { value: 'profile_name', label: 'اسم جهة الاتصال', icon: '👤' },
    { value: 'phone', label: 'رقم الهاتف', icon: '📱' },
    { value: 'label', label: 'التصنيف', icon: '🏷️' },
    { value: 'notes', label: 'الملاحظات', icon: '📝' },
];

function extractVariables(bodyText) {
    if (!bodyText) return [];
    const matches = bodyText.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    const nums = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))];
    return nums.sort((a, b) => a - b);
}

function previewBody(bodyText, variableConfigs) {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{(\d+)\}\}/g, (match, num) => {
        const config = variableConfigs[parseInt(num)];
        if (!config) return match;
        if (config.source === 'static') return config.value || match;
        if (config.source === 'contact') {
            const field = CONTACT_FIELDS.find(f => f.value === config.field);
            return `[${field?.label || config.field}]`;
        }
        return match;
    });
}

const TenantBroadcast = () => {
    const [activeStep, setActiveStep] = useState(0);
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [recipientsText, setRecipientsText] = useState('');
    const [templateLanguage, setTemplateLanguage] = useState('ar');
    const [variableConfigs, setVariableConfigs] = useState({});

    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    const variables = useMemo(() =>
        extractVariables(selectedTemplate?.body),
        [selectedTemplate]
    );

    const allVariablesFilled = useMemo(() => {
        if (variables.length === 0) return true;
        return variables.every(v => {
            const config = variableConfigs[v];
            if (!config) return false;
            if (config.source === 'static') return config.value?.trim();
            if (config.source === 'contact') return !!config.field;
            return false;
        });
    }, [variables, variableConfigs]);

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const data = await api.getPortalTemplates();
                setTemplates(data || []);
            } catch (err) {
                console.error('Failed to load templates:', err);
                setTemplates([]);
            }
        };
        loadTemplates();
    }, []);

    useEffect(() => {
        const newConfigs = {};
        variables.forEach(v => {
            newConfigs[v] = { source: 'static', value: '', field: '', fallback: '' };
        });
        setVariableConfigs(newConfigs);
    }, [selectedTemplate]);

    const recipients = recipientsText
        .split(/[\n,;]+/)
        .map(r => r.replace(/[^0-9+]/g, '').trim())
        .filter(r => r.length >= 8);

    const uniqueRecipients = [...new Set(recipients)];

    const canProceedStep0 = selectedTemplate && allVariablesFilled;
    const canProceedStep1 = uniqueRecipients.length > 0 && uniqueRecipients.length <= 100;

    const handleConfigChange = (varNum, key, value) => {
        setVariableConfigs(prev => ({
            ...prev,
            [varNum]: { ...prev[varNum], [key]: value }
        }));
    };

    const buildPayload = () => {
        const hasContactSource = variables.some(v => variableConfigs[v]?.source === 'contact');

        const payload = {
            recipients: uniqueRecipients,
            template_name: selectedTemplate.name,
            template_language: templateLanguage,
        };

        if (variables.length > 0) {
            if (hasContactSource) {
                payload.variable_mapping = variables.map(v => {
                    const config = variableConfigs[v];
                    if (config.source === 'contact') {
                        return { source: 'contact', field: config.field, fallback: config.fallback || '' };
                    }
                    return { source: 'static', value: config.value || '' };
                });
            } else {
                payload.template_params = [{
                    type: 'body',
                    parameters: variables.map(v => ({
                        type: 'text',
                        text: variableConfigs[v]?.value || ''
                    }))
                }];
            }
        }

        return payload;
    };

    const handleSend = async () => {
        if (!selectedTemplate || uniqueRecipients.length === 0) return;

        try {
            setSending(true);
            setError(null);
            setResults(null);

            const payload = buildPayload();
            const data = await api.portalBroadcast(payload);
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
        setSelectedTemplate(null);
        setRecipientsText('');
        setResults(null);
        setError(null);
        setVariableConfigs({});
    };

    const steps = ['اختيار القالب', 'إدخال المستلمين', 'مراجعة وإرسال', 'النتائج'];

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CampaignIcon fontSize="large" color="secondary" />
                    البث الجماعي
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إرسال قوالب رسائل إلى مجموعة من المستلمين دفعة واحدة (الحد الأقصى 100 مستلم)
                </Typography>
            </Box>

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
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>
            )}

            {/* Step 0: Select template + configure variables */}
            {activeStep === 0 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>اختيار القالب</Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
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
                                {templates.filter(t => t.status === 'approved' || t.status === 'APPROVED').map(t => (
                                    <MenuItem key={t.id} value={t.id}>
                                        {t.name} ({t.language || 'ar'})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {selectedTemplate && (
                            <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>معاينة القالب</Typography>
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 2, borderRadius: 1, direction: 'auto' }}>
                                        {selectedTemplate.body || 'لا يوجد محتوى'}
                                    </Typography>
                                </CardContent>
                            </Card>
                        )}

                        {/* Variable Configuration */}
                        {variables.length > 0 && (
                            <Box>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    هذا القالب يحتوي على {variables.length} متغير(ات). حدد مصدر كل متغير — نص ثابت أو بيانات من جهة الاتصال.
                                </Alert>

                                {variables.map(varNum => {
                                    const config = variableConfigs[varNum] || { source: 'static', value: '', field: '', fallback: '' };
                                    return (
                                        <Card key={varNum} variant="outlined" sx={{ mb: 2, p: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                <Chip label={`{{${varNum}}}`} size="small" color="secondary" />
                                                <ToggleButtonGroup
                                                    value={config.source}
                                                    exclusive
                                                    onChange={(_, val) => val && handleConfigChange(varNum, 'source', val)}
                                                    size="small"
                                                >
                                                    <ToggleButton value="static">
                                                        <Tooltip title="نص ثابت — نفس القيمة لجميع المستلمين">
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <StaticIcon fontSize="small" />
                                                                <span>نص ثابت</span>
                                                            </Box>
                                                        </Tooltip>
                                                    </ToggleButton>
                                                    <ToggleButton value="contact">
                                                        <Tooltip title="بيانات جهة الاتصال — قيمة مختلفة لكل مستلم">
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <ContactIcon fontSize="small" />
                                                                <span>بيانات المستلم</span>
                                                            </Box>
                                                        </Tooltip>
                                                    </ToggleButton>
                                                </ToggleButtonGroup>
                                            </Box>

                                            {config.source === 'static' ? (
                                                <TextField
                                                    label={`قيمة المتغير {{${varNum}}}`}
                                                    placeholder="أدخل النص الثابت..."
                                                    value={config.value}
                                                    onChange={(e) => handleConfigChange(varNum, 'value', e.target.value)}
                                                    fullWidth
                                                    size="small"
                                                    required
                                                    error={!config.value?.trim()}
                                                />
                                            ) : (
                                                <Box sx={{ display: 'flex', gap: 2 }}>
                                                    <FormControl size="small" sx={{ flex: 1 }}>
                                                        <InputLabel>حقل جهة الاتصال</InputLabel>
                                                        <Select
                                                            value={config.field}
                                                            label="حقل جهة الاتصال"
                                                            onChange={(e) => handleConfigChange(varNum, 'field', e.target.value)}
                                                        >
                                                            {CONTACT_FIELDS.map(f => (
                                                                <MenuItem key={f.value} value={f.value}>
                                                                    {f.icon} {f.label}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                    <TextField
                                                        label="قيمة بديلة"
                                                        placeholder="إذا لم يتوفر الحقل..."
                                                        value={config.fallback}
                                                        onChange={(e) => handleConfigChange(varNum, 'fallback', e.target.value)}
                                                        size="small"
                                                        sx={{ flex: 1 }}
                                                        helperText="تُستخدم إذا لم يكن لدى المستلم هذا الحقل"
                                                    />
                                                </Box>
                                            )}
                                        </Card>
                                    );
                                })}

                                <Card variant="outlined" sx={{ bgcolor: '#e8f5e9' }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>معاينة الرسالة</Typography>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', direction: 'auto' }}>
                                            {previewBody(selectedTemplate?.body, variableConfigs)}
                                        </Typography>
                                        {variables.some(v => variableConfigs[v]?.source === 'contact') && (
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                                * القيم بين أقواس مربعة [مثل هذه] ستُستبدل ببيانات كل مستلم تلقائياً
                                            </Typography>
                                        )}
                                    </CardContent>
                                </Card>
                            </Box>
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
                        <Button variant="contained" color="secondary" disabled={!canProceedStep0} onClick={() => setActiveStep(1)}>التالي</Button>
                    </Box>
                </Paper>
            )}

            {/* Step 1: Enter recipients */}
            {activeStep === 1 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>إدخال أرقام المستلمين</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        أدخل أرقام الهواتف — رقم واحد لكل سطر. الحد الأقصى 100 رقم.
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
                            color={uniqueRecipients.length > 100 ? 'error' : uniqueRecipients.length > 0 ? 'secondary' : 'default'}
                        />
                        {uniqueRecipients.length > 100 && (
                            <Alert severity="error" sx={{ flex: 1 }}>الحد الأقصى 100 مستلم</Alert>
                        )}
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(0)}>السابق</Button>
                        <Button variant="contained" color="secondary" disabled={!canProceedStep1} onClick={() => setActiveStep(2)}>التالي</Button>
                    </Box>
                </Paper>
            )}

            {/* Step 2: Review & Send */}
            {activeStep === 2 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>مراجعة وتأكيد الإرسال</Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
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

                        {selectedTemplate && (
                            <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>الرسالة</Typography>
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: '#f0f4f0', p: 1.5, borderRadius: 1, direction: 'auto' }}>
                                        {previewBody(selectedTemplate.body, variableConfigs)}
                                    </Typography>
                                </CardContent>
                            </Card>
                        )}

                        {variables.length > 0 && (
                            <Box>
                                <Typography variant="body2" color="text.secondary" gutterBottom>المتغيرات:</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {variables.map(v => {
                                        const config = variableConfigs[v];
                                        const label = config?.source === 'contact'
                                            ? `${CONTACT_FIELDS.find(f => f.value === config.field)?.label || config.field}`
                                            : config?.value || '—';
                                        return (
                                            <Chip
                                                key={v}
                                                label={`{{${v}}} = ${label}`}
                                                size="small"
                                                color={config?.source === 'contact' ? 'secondary' : 'primary'}
                                                variant="outlined"
                                                icon={config?.source === 'contact' ? <ContactIcon /> : <StaticIcon />}
                                            />
                                        );
                                    })}
                                </Box>
                            </Box>
                        )}

                        <Divider />
                        <Alert severity="warning">سيتم خصم {uniqueRecipients.length} رصيد من حسابك</Alert>
                    </Box>

                    {sending && (
                        <Box sx={{ mt: 3 }}>
                            <LinearProgress color="secondary" />
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
                    <Typography variant="h6" fontWeight={600} gutterBottom>نتائج البث</Typography>

                    <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700}>{results.total}</Typography>
                                <Typography variant="body2" color="text.secondary">إجمالي</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} color="success.main">{results.sent}</Typography>
                                <Typography variant="body2" color="text.secondary">نجاح</Typography>
                            </CardContent>
                        </Card>
                        <Card variant="outlined" sx={{ flex: 1, minWidth: 150 }}>
                            <CardContent sx={{ textAlign: 'center' }}>
                                <Typography variant="h3" fontWeight={700} color="error.main">{results.failed}</Typography>
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
                                            <TableCell>{r.message_id || r.error || '—'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
                        <Button variant="contained" color="secondary" onClick={handleReset}>بث جديد</Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default TenantBroadcast;
