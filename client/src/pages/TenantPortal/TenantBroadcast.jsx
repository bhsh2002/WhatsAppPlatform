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
    Tooltip,
    Checkbox,
    InputAdornment,
    Tabs,
    Tab
} from '@mui/material';
import {
    Campaign as CampaignIcon,
    Send as SendIcon,
    People as PeopleIcon,
    CheckCircle as SuccessIcon,
    Error as ErrorIcon,
    TextFields as StaticIcon,
    Person as ContactIcon,
    Search as SearchIcon,
    SelectAll as SelectAllIcon
} from '@mui/icons-material';
import api from '../../api';

const CONTACT_FIELDS = [
    { value: 'profile_name', label: 'اسم جهة الاتصال', icon: '👤' },
    { value: 'phone', label: 'رقم الهاتف', icon: '📱' },
    { value: 'label', label: 'التصنيف', icon: '🏷️' },
    { value: 'notes', label: 'الملاحظات', icon: '📝' },
];

function extractAllVariables(template) {
    const result = { header: [], body: [], buttons: [] };
    if (!template) return result;

    if (template.body) {
        const matches = template.body.match(/\{\{(\d+)\}\}/g);
        if (matches) {
            result.body = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))].sort((a, b) => a - b);
        }
    }

    if (template.header_type === 'text' && template.header_content) {
        const matches = template.header_content.match(/\{\{(\d+)\}\}/g);
        if (matches) {
            result.header = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))].sort((a, b) => a - b);
        }
    }

    if (template.buttons) {
        try {
            const buttons = typeof template.buttons === 'string' ? JSON.parse(template.buttons) : template.buttons;
            if (Array.isArray(buttons)) {
                buttons.forEach((btn, index) => {
                    if (btn.type === 'URL' && btn.url) {
                        const matches = btn.url.match(/\{\{(\d+)\}\}/g);
                        if (matches) {
                            result.buttons.push({
                                index: String(index),
                                sub_type: 'url',
                                text: btn.text,
                                url: btn.url,
                                variables: [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))].sort((a, b) => a - b),
                            });
                        }
                    }
                    if (btn.type === 'OTP' || btn.type === 'COPY_CODE' || btn.type === 'otp') {
                        result.buttons.push({
                            index: String(index),
                            sub_type: 'url',
                            text: btn.text || 'Copy Code',
                            isOtp: true,
                            variables: [1],
                        });
                    }
                });
            }
        } catch (_) { /* ignored */ }
    }

    return result;
}

function previewBody(bodyText, variableConfigs) {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{(\d+)\}\}/g, (match, num) => {
        const config = variableConfigs[`body_${num}`];
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
    const [templateLanguage, setTemplateLanguage] = useState('ar');
    const [variableConfigs, setVariableConfigs] = useState({});

    const [recipientsTab, setRecipientsTab] = useState(0);
    const [recipientsText, setRecipientsText] = useState('');
    const [contacts, setContacts] = useState([]);
    const [selectedContactIds, setSelectedContactIds] = useState(new Set());
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const [labelFilter, setLabelFilter] = useState('');

    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);
    const [progressPct, setProgressPct] = useState(0);

    const allVars = useMemo(() => extractAllVariables(selectedTemplate), [selectedTemplate]);

    const hasAnyVariables = allVars.body.length > 0 || allVars.header.length > 0 || allVars.buttons.length > 0;

    const allVariablesFilled = useMemo(() => {
        if (!hasAnyVariables) return true;
        const required = [
            ...allVars.header.map(v => `header_${v}`),
            ...allVars.body.map(v => `body_${v}`),
            ...allVars.buttons.flatMap(btn => btn.variables.map(v => `button_${btn.index}_${v}`)),
        ];
        return required.every(key => {
            const config = variableConfigs[key];
            if (!config) return false;
            if (config.source === 'static') return config.value?.trim();
            if (config.source === 'contact') return !!config.field;
            return false;
        });
    }, [allVars, hasAnyVariables, variableConfigs]);

    const uniqueLabels = useMemo(() => {
        const labels = contacts.map(c => c.label).filter(Boolean);
        return [...new Set(labels)].sort();
    }, [contacts]);

    const filteredContacts = useMemo(() => {
        return contacts.filter(c => {
            const matchesSearch = !contactSearch ||
                (c.profile_name || '').toLowerCase().includes(contactSearch.toLowerCase()) ||
                (c.phone || '').includes(contactSearch);
            const matchesLabel = !labelFilter || c.label === labelFilter;
            return matchesSearch && matchesLabel;
        });
    }, [contacts, contactSearch, labelFilter]);

    const manualRecipients = recipientsText
        .split(/[\n,;]+/)
        .map(r => r.replace(/[^0-9+]/g, '').trim())
        .filter(r => r.length >= 8);

    const selectedContactPhones = contacts
        .filter(c => selectedContactIds.has(c.id))
        .map(c => c.phone);

    const uniqueRecipients = useMemo(() => {
        return [...new Set([...selectedContactPhones, ...manualRecipients])];
    }, [selectedContactIds, contacts, recipientsText]);

    const canProceedStep0 = selectedTemplate && (!hasAnyVariables || allVariablesFilled);
    const canProceedStep1 = uniqueRecipients.length > 0 && uniqueRecipients.length <= 100;

    useEffect(() => {
        const load = async () => {
            try {
                const data = await api.getPortalTemplates();
                setTemplates(data || []);
            } catch (_) {
                setTemplates([]);
            }
            try {
                setContactsLoading(true);
                const data = await api.getPortalContacts();
                setContacts(data.contacts || data || []);
            } catch (_) {
                setContacts([]);
            } finally {
                setContactsLoading(false);
            }
        };
        load();
    }, []);

    useEffect(() => {
        const newConfigs = {};
        allVars.header.forEach(v => {
            newConfigs[`header_${v}`] = { source: 'static', value: '', field: '', fallback: '' };
        });
        allVars.body.forEach(v => {
            newConfigs[`body_${v}`] = { source: 'static', value: '', field: '', fallback: '' };
        });
        allVars.buttons.forEach(btn => {
            btn.variables.forEach(v => {
                newConfigs[`button_${btn.index}_${v}`] = { source: 'static', value: '', field: '', fallback: '' };
            });
        });
        setVariableConfigs(newConfigs);
    }, [selectedTemplate]);

    const handleToggleContact = (contactId) => {
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            if (next.has(contactId)) next.delete(contactId);
            else next.add(contactId);
            return next;
        });
    };

    const handleSelectAll = () => {
        const ids = filteredContacts.map(c => c.id);
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.add(id));
            return next;
        });
    };

    const handleDeselectAll = () => {
        const ids = new Set(filteredContacts.map(c => c.id));
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
        });
    };

    const handleSelectByLabel = (label) => {
        const ids = contacts.filter(c => c.label === label).map(c => c.id);
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.add(id));
            return next;
        });
    };

    const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContactIds.has(c.id));

    const handleConfigChange = (varKey, key, value) => {
        setVariableConfigs(prev => ({
            ...prev,
            [varKey]: { ...prev[varKey], [key]: value }
        }));
    };

    const buildPayload = () => {
        const hasContactSource = Object.values(variableConfigs).some(c => c?.source === 'contact');
        const payload = {
            recipients: uniqueRecipients,
            template_name: selectedTemplate.name,
            template_language: templateLanguage,
        };

        if (hasAnyVariables) {
            if (hasContactSource) {
                payload.variable_mapping = [
                    ...allVars.header.map(v => {
                        const config = variableConfigs[`header_${v}`];
                        if (config?.source === 'contact') {
                            return { source: 'contact', field: config.field, fallback: config.fallback || '', section: 'header', index: v };
                        }
                        return { source: 'static', value: config?.value || '', section: 'header', index: v };
                    }),
                    ...allVars.body.map(v => {
                        const config = variableConfigs[`body_${v}`];
                        if (config?.source === 'contact') {
                            return { source: 'contact', field: config.field, fallback: config.fallback || '', section: 'body', index: v };
                        }
                        return { source: 'static', value: config?.value || '', section: 'body', index: v };
                    }),
                    ...allVars.buttons.flatMap(btn =>
                        btn.variables.map(v => {
                            const config = variableConfigs[`button_${btn.index}_${v}`];
                            if (config?.source === 'contact') {
                                return { source: 'contact', field: config.field, fallback: config.fallback || '', section: 'button', btn_index: btn.index, index: v };
                            }
                            return { source: 'static', value: config?.value || '', section: 'button', btn_index: btn.index, index: v };
                        })
                    ),
                ];
            } else {
                const components = [];

                if (allVars.header.length > 0) {
                    components.push({
                        type: 'header',
                        parameters: allVars.header.map(v => ({
                            type: 'text',
                            text: variableConfigs[`header_${v}`]?.value || '',
                        })),
                    });
                }

                if (allVars.body.length > 0) {
                    components.push({
                        type: 'body',
                        parameters: allVars.body.map(v => ({
                            type: 'text',
                            text: variableConfigs[`body_${v}`]?.value || '',
                        })),
                    });
                }

                allVars.buttons.forEach(btn => {
                    components.push({
                        type: 'button',
                        sub_type: 'url',
                        index: btn.index,
                        parameters: btn.variables.map(v => ({
                            type: 'text',
                            text: variableConfigs[`button_${btn.index}_${v}`]?.value || '',
                        })),
                    });
                });

                if (components.length > 0) {
                    payload.template_params = components;
                }
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
            setProgressPct(0);
            const data = await api.portalBroadcast(buildPayload());

            if (data.job_id) {
                pollJobStatus(data.job_id);
            } else {
                setResults(data);
                setActiveStep(3);
                setSending(false);
            }
        } catch (err) {
            setError(err.message);
            setSending(false);
        }
    };

    const pollJobStatus = (id) => {
        const interval = setInterval(async () => {
            try {
                const job = await api.getPortalBroadcastJob(id);
                setProgressPct(job.progress_pct || 0);
                if (job.status === 'completed') {
                    clearInterval(interval);
                    const parsedResults = job.results ? (typeof job.results === 'string' ? JSON.parse(job.results) : job.results) : [];
                    setResults({ total: job.total_recipients, sent: job.sent_count, failed: job.failed_count, results: parsedResults });
                    setActiveStep(3);
                    setSending(false);
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    setError(job.error || 'فشل البث');
                    setSending(false);
                }
            } catch {
                // Continue polling on transient errors
            }
        }, 1500);
    };

    const handleReset = () => {
        setActiveStep(0);
        setSelectedTemplate(null);
        setRecipientsText('');
        setResults(null);
        setError(null);
        setVariableConfigs({});
        setSelectedContactIds(new Set());
        setContactSearch('');
        setLabelFilter('');
        setProgressPct(0);
    };

    const steps = ['اختيار القالب', 'اختيار المستلمين', 'مراجعة وإرسال', 'النتائج'];

    const renderVariableInput = (varKey, label) => {
        const config = variableConfigs[varKey] || { source: 'static', value: '', field: '', fallback: '' };
        return (
            <Card key={varKey} variant="outlined" sx={{ mb: 2, p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Chip label={label} size="small" color="secondary" />
                    <ToggleButtonGroup value={config.source} exclusive onChange={(_, val) => val && handleConfigChange(varKey, 'source', val)} size="small">
                        <ToggleButton value="static">
                            <Tooltip title="نص ثابت — نفس القيمة لجميع المستلمين">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><StaticIcon fontSize="small" /><span>نص ثابت</span></Box>
                            </Tooltip>
                        </ToggleButton>
                        <ToggleButton value="contact">
                            <Tooltip title="بيانات جهة الاتصال — قيمة مختلفة لكل مستلم">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><ContactIcon fontSize="small" /><span>بيانات المستلم</span></Box>
                            </Tooltip>
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>
                {config.source === 'static' ? (
                    <TextField label={`قيمة ${label}`} value={config.value} onChange={(e) => handleConfigChange(varKey, 'value', e.target.value)} fullWidth size="small" required error={!config.value?.trim()} />
                ) : (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl size="small" sx={{ flex: 1 }}>
                            <InputLabel>حقل جهة الاتصال</InputLabel>
                            <Select value={config.field} label="حقل جهة الاتصال" onChange={(e) => handleConfigChange(varKey, 'field', e.target.value)}>
                                {CONTACT_FIELDS.map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField label="قيمة بديلة" value={config.fallback} onChange={(e) => handleConfigChange(varKey, 'fallback', e.target.value)} size="small" sx={{ flex: 1 }} helperText="تُستخدم إذا لم يكن لدى المستلم هذا الحقل" />
                    </Box>
                )}
            </Card>
        );
    };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
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
                        <Step key={label}><StepLabel>{label}</StepLabel></Step>
                    ))}
                </Stepper>
            </Paper>

            {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

            {/* ========== Step 0: Select template & variables ========== */}
            {activeStep === 0 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>اختيار القالب</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
                        <FormControl fullWidth>
                            <InputLabel>القالب</InputLabel>
                            <Select value={selectedTemplate?.id || ''} label="القالب" onChange={(e) => {
                                setSelectedTemplate(templates.find(t => t.id === e.target.value));
                            }}>
                                {templates.filter(t => t.status?.toLowerCase() === 'approved').map(t => (
                                    <MenuItem key={t.id} value={t.id}>{t.name} ({t.language || 'ar'})</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {selectedTemplate && (
                            <Card variant="outlined">
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>معاينة القالب</Typography>
                                    {selectedTemplate.header_type === 'text' && selectedTemplate.header_content && (
                                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, direction: 'auto' }}>
                                            {selectedTemplate.header_content}
                                        </Typography>
                                    )}
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 2, borderRadius: 1, direction: 'auto' }}>
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

                        {hasAnyVariables && (
                            <Box>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    هذا القالب يحتوي على متغيرات. حدد مصدر كل متغير.
                                </Alert>
                                {allVars.header.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>متغيرات العنوان</Typography>
                                        {allVars.header.map(v => renderVariableInput(`header_${v}`, `عنوان {{${v}}}`))}
                                    </Box>
                                )}
                                {allVars.body.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>متغيرات النص</Typography>
                                        {allVars.body.map(v => renderVariableInput(`body_${v}`, `نص {{${v}}}`))}
                                    </Box>
                                )}
                                {allVars.buttons.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>متغيرات الأزرار</Typography>
                                        {allVars.buttons.map(btn =>
                                            btn.variables.map(v => renderVariableInput(`button_${btn.index}_${v}`, `زر "${btn.text}" {{${v}}}`))
                                        )}
                                    </Box>
                                )}
                                <Card variant="outlined" sx={{ bgcolor: '#e8f5e9' }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>معاينة الرسالة</Typography>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', direction: 'auto' }}>{previewBody(selectedTemplate?.body, variableConfigs)}</Typography>
                                        {Object.values(variableConfigs).some(c => c?.source === 'contact') && (
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>* القيم بين أقواس مربعة ستُستبدل ببيانات كل مستلم تلقائياً</Typography>
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

            {/* ========== Step 1: Select recipients ========== */}
            {activeStep === 1 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>اختيار المستلمين</Typography>

                    <Tabs value={recipientsTab} onChange={(_, v) => setRecipientsTab(v)} sx={{ mb: 2 }}>
                        <Tab icon={<PeopleIcon />} iconPosition="start" label={`من جهات الاتصال (${contacts.length})`} />
                        <Tab icon={<StaticIcon />} iconPosition="start" label="إدخال يدوي" />
                    </Tabs>

                    {recipientsTab === 0 && (
                        <Box>
                            {contactsLoading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                            ) : contacts.length === 0 ? (
                                <Alert severity="info" sx={{ mb: 2 }}>لا توجد جهات اتصال. يمكنك إضافتها من صفحة جهات الاتصال أو الإدخال يدوياً.</Alert>
                            ) : (
                                <>
                                    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                        <TextField
                                            size="small"
                                            placeholder="بحث بالاسم أو الرقم..."
                                            value={contactSearch}
                                            onChange={(e) => setContactSearch(e.target.value)}
                                            sx={{ flex: 1, minWidth: 200 }}
                                            InputProps={{
                                                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                                            }}
                                        />
                                        <FormControl size="small" sx={{ minWidth: 150 }}>
                                            <InputLabel>تصفية بالتصنيف</InputLabel>
                                            <Select value={labelFilter} label="تصفية بالتصنيف" onChange={(e) => setLabelFilter(e.target.value)}>
                                                <MenuItem value="">الكل</MenuItem>
                                                {uniqueLabels.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
                                            </Select>
                                        </FormControl>
                                    </Box>

                                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <Button size="small" variant="outlined" startIcon={<SelectAllIcon />} onClick={handleSelectAll}>
                                            تحديد الكل ({filteredContacts.length})
                                        </Button>
                                        <Button size="small" variant="outlined" color="inherit" onClick={handleDeselectAll}>
                                            إلغاء التحديد
                                        </Button>
                                        {uniqueLabels.length > 0 && (
                                            <>
                                                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                                                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>تحديد حسب التصنيف:</Typography>
                                                {uniqueLabels.map(label => (
                                                    <Chip key={label} label={label} size="small" variant="outlined" onClick={() => handleSelectByLabel(label)} sx={{ cursor: 'pointer' }} />
                                                ))}
                                            </>
                                        )}
                                    </Box>

                                    <TableContainer sx={{ maxHeight: 400, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                        <Table stickyHeader size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell padding="checkbox">
                                                        <Checkbox
                                                            checked={allFilteredSelected}
                                                            indeterminate={!allFilteredSelected && filteredContacts.some(c => selectedContactIds.has(c.id))}
                                                            onChange={() => allFilteredSelected ? handleDeselectAll() : handleSelectAll()}
                                                        />
                                                    </TableCell>
                                                    <TableCell>الاسم</TableCell>
                                                    <TableCell>الرقم</TableCell>
                                                    <TableCell>التصنيف</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {filteredContacts.map(contact => (
                                                    <TableRow
                                                        key={contact.id}
                                                        hover
                                                        onClick={() => handleToggleContact(contact.id)}
                                                        sx={{ cursor: 'pointer' }}
                                                        selected={selectedContactIds.has(contact.id)}
                                                    >
                                                        <TableCell padding="checkbox">
                                                            <Checkbox checked={selectedContactIds.has(contact.id)} />
                                                        </TableCell>
                                                        <TableCell>{contact.profile_name || '—'}</TableCell>
                                                        <TableCell sx={{ fontFamily: 'monospace', direction: 'ltr' }}>{contact.phone}</TableCell>
                                                        <TableCell>
                                                            {contact.label && <Chip label={contact.label} size="small" variant="outlined" />}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </>
                            )}
                        </Box>
                    )}

                    {recipientsTab === 1 && (
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                أدخل أرقام هواتف إضافية — رقم واحد لكل سطر. سيتم دمجها مع جهات الاتصال المحددة.
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={8}
                                placeholder={"218911234567\n218921234567\n+218931234567"}
                                value={recipientsText}
                                onChange={(e) => setRecipientsText(e.target.value)}
                                sx={{ fontFamily: 'monospace' }}
                            />
                        </Box>
                    )}

                    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        {selectedContactIds.size > 0 && (
                            <Chip icon={<PeopleIcon />} label={`${selectedContactIds.size} من جهات الاتصال`} color="secondary" size="small" />
                        )}
                        {manualRecipients.length > 0 && (
                            <Chip icon={<StaticIcon />} label={`${manualRecipients.length} إدخال يدوي`} color="default" size="small" />
                        )}
                        <Chip
                            icon={<SendIcon />}
                            label={`${uniqueRecipients.length} مستلم إجمالي`}
                            color={uniqueRecipients.length > 100 ? 'error' : uniqueRecipients.length > 0 ? 'success' : 'default'}
                        />
                        {uniqueRecipients.length > 100 && <Alert severity="error" sx={{ flex: 1 }}>الحد الأقصى 100 مستلم</Alert>}
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(0)}>السابق</Button>
                        <Button variant="contained" color="secondary" disabled={!canProceedStep1} onClick={() => setActiveStep(2)}>التالي</Button>
                    </Box>
                </Paper>
            )}

            {/* ========== Step 2: Review & Send ========== */}
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

                        {hasAnyVariables && (
                            <Box>
                                <Typography variant="body2" color="text.secondary" gutterBottom>المتغيرات:</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {allVars.header.map(v => {
                                        const config = variableConfigs[`header_${v}`];
                                        const label = config?.source === 'contact'
                                            ? CONTACT_FIELDS.find(f => f.value === config.field)?.label || config.field
                                            : config?.value || '—';
                                        return <Chip key={`h${v}`} label={`عنوان {{${v}}} = ${label}`} size="small" color="secondary" variant="outlined" />;
                                    })}
                                    {allVars.body.map(v => {
                                        const config = variableConfigs[`body_${v}`];
                                        const label = config?.source === 'contact'
                                            ? CONTACT_FIELDS.find(f => f.value === config.field)?.label || config.field
                                            : config?.value || '—';
                                        return <Chip key={`b${v}`} label={`نص {{${v}}} = ${label}`} size="small" color="primary" variant="outlined" icon={config?.source === 'contact' ? <ContactIcon /> : <StaticIcon />} />;
                                    })}
                                    {allVars.buttons.flatMap(btn =>
                                        btn.variables.map(v => {
                                            const config = variableConfigs[`button_${btn.index}_${v}`];
                                            const label = config?.source === 'contact'
                                                ? CONTACT_FIELDS.find(f => f.value === config.field)?.label || config.field
                                                : config?.value || '—';
                                            return <Chip key={`btn${btn.index}_${v}`} label={`زر {{${v}}} = ${label}`} size="small" color="default" variant="outlined" />;
                                        })
                                    )}
                                </Box>
                            </Box>
                        )}
                        <Divider />
                        <Alert severity="warning">سيتم خصم {uniqueRecipients.length} رصيد من حسابك</Alert>
                    </Box>

                    {sending && (
                        <Box sx={{ mt: 3 }}>
                            <LinearProgress variant="determinate" value={progressPct} color="secondary" sx={{ height: 8, borderRadius: 4 }} />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                                {progressPct > 0 ? `${progressPct}% جاري الإرسال...` : 'جاري إرسال الرسائل...'}
                            </Typography>
                        </Box>
                    )}

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(1)} disabled={sending}>السابق</Button>
                        <Button variant="contained" color="success" startIcon={sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />} onClick={handleSend} disabled={sending} size="large">
                            {sending ? 'جاري الإرسال...' : `إرسال إلى ${uniqueRecipients.length} مستلم`}
                        </Button>
                    </Box>
                </Paper>
            )}

            {/* ========== Step 3: Results ========== */}
            {activeStep === 3 && results && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                        ✅ اكتمل: {results.sent} نجاح{results.failed > 0 ? `، ${results.failed} فشل` : ''}
                    </Typography>
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

                    {results.results?.length > 0 && (
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
                                                <Chip icon={r.status === 'sent' ? <SuccessIcon /> : <ErrorIcon />} label={r.status === 'sent' ? 'نجاح' : 'فشل'} color={r.status === 'sent' ? 'success' : 'error'} size="small" />
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
