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

const BroadcastManager = () => {
    const [activeStep, setActiveStep] = useState(0);
    const [tenants, setTenants] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState('');
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templateLanguage, setTemplateLanguage] = useState('ar');
    const [variableConfigs, setVariableConfigs] = useState({});

    // Recipients
    const [recipientsTab, setRecipientsTab] = useState(0); // 0=contacts, 1=manual
    const [recipientsText, setRecipientsText] = useState('');
    const [contacts, setContacts] = useState([]);
    const [selectedContactIds, setSelectedContactIds] = useState(new Set());
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const [labelFilter, setLabelFilter] = useState('');

    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    const variables = useMemo(() => extractVariables(selectedTemplate?.body), [selectedTemplate]);

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

    // Unique labels from contacts for filtering
    const uniqueLabels = useMemo(() => {
        const labels = contacts.map(c => c.label).filter(Boolean);
        return [...new Set(labels)].sort();
    }, [contacts]);

    // Filtered contacts based on search and label filter
    const filteredContacts = useMemo(() => {
        return contacts.filter(c => {
            const matchesSearch = !contactSearch ||
                (c.profile_name || '').toLowerCase().includes(contactSearch.toLowerCase()) ||
                (c.phone || '').includes(contactSearch);
            const matchesLabel = !labelFilter || c.label === labelFilter;
            return matchesSearch && matchesLabel;
        });
    }, [contacts, contactSearch, labelFilter]);

    // Merge selected contacts + manual numbers into unique recipients
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

    const selectedTenant = tenants.find(t => t.id === parseInt(selectedTenantId));
    const canProceedStep0 = selectedTenantId && selectedTemplate && allVariablesFilled;
    const canProceedStep1 = uniqueRecipients.length > 0 && uniqueRecipients.length <= 500;

    // Load tenants
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

    // Load templates + contacts when tenant changes
    useEffect(() => {
        if (!selectedTenantId) {
            setTemplates([]);
            setSelectedTemplate(null);
            setContacts([]);
            setSelectedContactIds(new Set());
            return;
        }
        const load = async () => {
            try {
                const data = await api.getAdminTemplates(selectedTenantId);
                setTemplates(data || []);
            } catch (err) {
                setTemplates([]);
            }
            try {
                setContactsLoading(true);
                const data = await api.getContacts({ tenant_id: selectedTenantId });
                setContacts(data.contacts || data || []);
            } catch (err) {
                setContacts([]);
            } finally {
                setContactsLoading(false);
            }
        };
        load();
        setSelectedContactIds(new Set());
    }, [selectedTenantId]);

    // Reset variable configs when template changes
    useEffect(() => {
        const newConfigs = {};
        variables.forEach(v => {
            newConfigs[v] = { source: 'static', value: '', field: '', fallback: '' };
        });
        setVariableConfigs(newConfigs);
    }, [selectedTemplate]);

    // Contact selection handlers
    const handleToggleContact = (contactId) => {
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            if (next.has(contactId)) next.delete(contactId);
            else next.add(contactId);
            return next;
        });
    };

    const handleSelectAll = () => {
        const allFilteredIds = filteredContacts.map(c => c.id);
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            allFilteredIds.forEach(id => next.add(id));
            return next;
        });
    };

    const handleDeselectAll = () => {
        const allFilteredIds = new Set(filteredContacts.map(c => c.id));
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            allFilteredIds.forEach(id => next.delete(id));
            return next;
        });
    };

    const handleSelectByLabel = (label) => {
        const labelContactIds = contacts.filter(c => c.label === label).map(c => c.id);
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            labelContactIds.forEach(id => next.add(id));
            return next;
        });
    };

    const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedContactIds.has(c.id));

    const handleConfigChange = (varNum, key, value) => {
        setVariableConfigs(prev => ({
            ...prev,
            [varNum]: { ...prev[varNum], [key]: value }
        }));
    };

    const buildPayload = () => {
        const hasContactSource = variables.some(v => variableConfigs[v]?.source === 'contact');
        const payload = {
            tenant_id: parseInt(selectedTenantId),
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
                    parameters: variables.map(v => ({ type: 'text', text: variableConfigs[v]?.value || '' }))
                }];
            }
        }
        return payload;
    };

    const handleSend = async () => {
        if (!selectedTenantId || !selectedTemplate || uniqueRecipients.length === 0) return;
        try {
            setSending(true);
            setError(null);
            setResults(null);
            const data = await api.broadcastMessage(buildPayload());
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
        setVariableConfigs({});
        setSelectedContactIds(new Set());
        setContactSearch('');
        setLabelFilter('');
    };

    const steps = ['اختيار القالب', 'اختيار المستلمين', 'مراجعة وإرسال', 'النتائج'];

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CampaignIcon fontSize="large" color="primary" />
                    البث الجماعي
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    إرسال قوالب رسائل إلى مجموعة من المستلمين دفعة واحدة
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

            {/* ========== Step 0: Select tenant, template & variables ========== */}
            {activeStep === 0 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>اختيار العميل والقالب</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
                        <FormControl fullWidth>
                            <InputLabel>العميل</InputLabel>
                            <Select value={selectedTenantId} label="العميل" onChange={(e) => {
                                setSelectedTenantId(e.target.value);
                                setSelectedTemplate(null);
                                setVariableConfigs({});
                            }}>
                                {tenants.map(t => (
                                    <MenuItem key={t.id} value={t.id}>{t.name} — رصيد: {t.credits?.toLocaleString() || 0}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {templates.length > 0 && (
                            <FormControl fullWidth>
                                <InputLabel>القالب</InputLabel>
                                <Select value={selectedTemplate?.id || ''} label="القالب" onChange={(e) => {
                                    setSelectedTemplate(templates.find(t => t.id === e.target.value));
                                }}>
                                    {templates.filter(t => t.status === 'approved').map(t => (
                                        <MenuItem key={t.id} value={t.id}>{t.name} ({t.language || 'ar'})</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

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

                        {variables.length > 0 && (
                            <Box>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    هذا القالب يحتوي على {variables.length} متغير(ات). حدد مصدر كل متغير.
                                </Alert>
                                {variables.map(varNum => {
                                    const config = variableConfigs[varNum] || { source: 'static', value: '', field: '', fallback: '' };
                                    return (
                                        <Card key={varNum} variant="outlined" sx={{ mb: 2, p: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                <Chip label={`{{${varNum}}}`} size="small" color="primary" />
                                                <ToggleButtonGroup value={config.source} exclusive onChange={(_, val) => val && handleConfigChange(varNum, 'source', val)} size="small">
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
                                                <TextField label={`قيمة المتغير {{${varNum}}}`} value={config.value} onChange={(e) => handleConfigChange(varNum, 'value', e.target.value)} fullWidth size="small" required error={!config.value?.trim()} />
                                            ) : (
                                                <Box sx={{ display: 'flex', gap: 2 }}>
                                                    <FormControl size="small" sx={{ flex: 1 }}>
                                                        <InputLabel>حقل جهة الاتصال</InputLabel>
                                                        <Select value={config.field} label="حقل جهة الاتصال" onChange={(e) => handleConfigChange(varNum, 'field', e.target.value)}>
                                                            {CONTACT_FIELDS.map(f => <MenuItem key={f.value} value={f.value}>{f.icon} {f.label}</MenuItem>)}
                                                        </Select>
                                                    </FormControl>
                                                    <TextField label="قيمة بديلة" value={config.fallback} onChange={(e) => handleConfigChange(varNum, 'fallback', e.target.value)} size="small" sx={{ flex: 1 }} helperText="تُستخدم إذا لم يكن لدى المستلم هذا الحقل" />
                                                </Box>
                                            )}
                                        </Card>
                                    );
                                })}
                                <Card variant="outlined" sx={{ bgcolor: '#e8f5e9' }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>معاينة الرسالة</Typography>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', direction: 'auto' }}>{previewBody(selectedTemplate?.body, variableConfigs)}</Typography>
                                        {variables.some(v => variableConfigs[v]?.source === 'contact') && (
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
                        <Button variant="contained" disabled={!canProceedStep0} onClick={() => setActiveStep(1)}>التالي</Button>
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

                    {/* Tab 0: Select from contacts */}
                    {recipientsTab === 0 && (
                        <Box>
                            {contactsLoading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                            ) : contacts.length === 0 ? (
                                <Alert severity="info" sx={{ mb: 2 }}>لا توجد جهات اتصال لهذا العميل. يمكنك إضافتها من صفحة جهات الاتصال أو الإدخال يدوياً.</Alert>
                            ) : (
                                <>
                                    {/* Search & Filter Bar */}
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

                                    {/* Action Buttons */}
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
                                                    <Chip
                                                        key={label}
                                                        label={label}
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => handleSelectByLabel(label)}
                                                        sx={{ cursor: 'pointer' }}
                                                    />
                                                ))}
                                            </>
                                        )}
                                    </Box>

                                    {/* Contacts Table */}
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

                    {/* Tab 1: Manual entry */}
                    {recipientsTab === 1 && (
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                أدخل أرقام هواتف إضافية — رقم واحد لكل سطر. سيتم دمجها مع جهات الاتصال المحددة أعلاه.
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

                    {/* Summary */}
                    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        {selectedContactIds.size > 0 && (
                            <Chip icon={<PeopleIcon />} label={`${selectedContactIds.size} من جهات الاتصال`} color="primary" size="small" />
                        )}
                        {manualRecipients.length > 0 && (
                            <Chip icon={<StaticIcon />} label={`${manualRecipients.length} إدخال يدوي`} color="default" size="small" />
                        )}
                        <Chip
                            icon={<SendIcon />}
                            label={`${uniqueRecipients.length} مستلم إجمالي`}
                            color={uniqueRecipients.length > 500 ? 'error' : uniqueRecipients.length > 0 ? 'success' : 'default'}
                        />
                        {uniqueRecipients.length > 500 && <Alert severity="error" sx={{ flex: 1 }}>الحد الأقصى 500 مستلم</Alert>}
                        {selectedTenant && selectedTenant.credits !== null && selectedTenant.credits < uniqueRecipients.length && (
                            <Alert severity="warning" sx={{ flex: 1 }}>رصيد العميل ({selectedTenant.credits}) أقل من عدد المستلمين</Alert>
                        )}
                    </Box>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                        <Button onClick={() => setActiveStep(0)}>السابق</Button>
                        <Button variant="contained" disabled={!canProceedStep1} onClick={() => setActiveStep(2)}>التالي</Button>
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
                                            ? CONTACT_FIELDS.find(f => f.value === config.field)?.label || config.field
                                            : config?.value || '—';
                                        return <Chip key={v} label={`{{${v}}} = ${label}`} size="small" color={config?.source === 'contact' ? 'secondary' : 'primary'} variant="outlined" icon={config?.source === 'contact' ? <ContactIcon /> : <StaticIcon />} />;
                                    })}
                                </Box>
                            </Box>
                        )}
                        <Divider />
                        <Alert severity="info">الوقت المقدر: ~{Math.ceil(uniqueRecipients.length / 10)} ثانية</Alert>
                    </Box>

                    {sending && (
                        <Box sx={{ mt: 3 }}>
                            <LinearProgress />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>جاري إرسال الرسائل...</Typography>
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
                        <Button variant="contained" onClick={handleReset}>بث جديد</Button>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

export default BroadcastManager;
