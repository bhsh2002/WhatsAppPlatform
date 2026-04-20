import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    Alert,
    CircularProgress,
    Grid,
    Checkbox,
    ListItemText,
    Card,
    CardContent,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip
} from '@mui/material';
import {
    Close as CloseIcon,
    Send as SendIcon,
    TextFields as StaticIcon,
    Person as ContactIcon
} from '@mui/icons-material';

function extractAllVariables(template) {
    const result = { header: [], body: [], buttons: [] };
    if (!template) return result;

    if (template.body) {
        const matches = template.body.match(/\{\{([^}]+)\}\}/g);
        if (matches) {
            result.body = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
        }
    }

    if (template.header_type === 'text' && template.header_content) {
        const matches = template.header_content.match(/\{\{([^}]+)\}\}/g);
        if (matches) {
            result.header = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
        }
    } else if (['image', 'video', 'document', 'audio'].includes(template.header_type?.toLowerCase())) {
        result.header = ['MEDIA_LINK'];
    }

    if (template.buttons) {
        try {
            const buttons = typeof template.buttons === 'string' ? JSON.parse(template.buttons) : template.buttons;
            if (Array.isArray(buttons)) {
                buttons.forEach((btn, index) => {
                    if (btn.type === 'URL' && btn.url) {
                        const matches = btn.url.match(/\{\{([^}]+)\}\}/g);
                        if (matches) {
                            result.buttons.push({
                                index: String(index),
                                sub_type: 'url',
                                text: btn.text,
                                url: btn.url,
                                variables: [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))],
                            });
                        }
                    }
                    if (btn.type === 'OTP' || btn.type === 'COPY_CODE' || btn.type === 'otp') {
                        result.buttons.push({
                            index: String(index),
                            sub_type: 'url',
                            text: btn.text || 'Copy Code',
                            isOtp: true,
                            variables: ['1'],
                        });
                    }
                });
            }
        } catch (_) { /* ignored */ }
    }

    return result;
}

function previewBody(bodyText, variableValues) {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        const val = variableValues[`body_${varName}`];
        return val ? val : match;
    });
}

const BroadcastDialog = ({
    open,
    onClose,
    onSend,
    contacts = [],
    templates = [],
}) => {
    const [step, setStep] = useState(1);
    const [selectedContacts, setSelectedContacts] = useState([]);
    const [customNumbers, setCustomNumbers] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [templateLanguage, setTemplateLanguage] = useState('ar');
    const [searchTerm, setSearchTerm] = useState('');
    const [sending, setSending] = useState(false);
    const [variableValues, setVariableValues] = useState({});

    const templateObj = useMemo(() =>
        templates.find(t => t.name === selectedTemplate),
        [templates, selectedTemplate]
    );

    const allVars = useMemo(() => extractAllVariables(templateObj), [templateObj]);

    const allVariableKeys = useMemo(() => {
        const keys = [];
        allVars.header.forEach(v => keys.push(`header_${v}`));
        allVars.body.forEach(v => keys.push(`body_${v}`));
        allVars.buttons.forEach(btn => btn.variables.forEach(v => keys.push(`button_${btn.index}_${v}`)));
        return keys;
    }, [allVars]);

    const allVariablesFilled = useMemo(() =>
        allVariableKeys.length === 0 || allVariableKeys.every(key => variableValues[key]?.trim()),
        [allVariableKeys, variableValues]
    );

    useEffect(() => {
        if (open) {
            setSelectedContacts([]);
            setCustomNumbers('');
            setSelectedTemplate('');
            setTemplateLanguage('ar');
            setSearchTerm('');
            setStep(1);
            setSending(false);
            setVariableValues({});
        }
    }, [open]);

    useEffect(() => {
        const defaults = {};
        allVariableKeys.forEach(key => {
            if (!(key in defaults)) defaults[key] = '';
        });
        setVariableValues(prev => {
            const next = {};
            allVariableKeys.forEach(key => {
                next[key] = prev[key] !== undefined ? prev[key] : '';
            });
            return next;
        });
    }, [selectedTemplate]);

    const filteredContacts = contacts.filter(c =>
        c.phone?.includes(searchTerm) ||
        c.profile_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const allRecipients = [
        ...selectedContacts,
        ...customNumbers
            .split(/[,\n]/)
            .map(n => n.trim())
            .filter(n => n.length >= 9)
    ];

    const handleToggleContact = (phone) => {
        setSelectedContacts(prev =>
            prev.includes(phone)
                ? prev.filter(p => p !== phone)
                : [...prev, phone]
        );
    };

    const handleSelectAll = () => {
        if (selectedContacts.length === filteredContacts.length) {
            setSelectedContacts([]);
        } else {
            setSelectedContacts(filteredContacts.map(c => c.phone));
        }
    };

    const handleVariableChange = (key, value) => {
        setVariableValues(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const buildTemplateParams = () => {
        const components = [];
        const isNamed = templateObj?.parameter_format === 'named';

        if (allVars.header.length > 0) {
            components.push({
                type: 'header',
                parameters: allVars.header.map(v => {
                    if (v === 'MEDIA_LINK') {
                        const hType = templateObj.header_type.toLowerCase();
                        return {
                            type: hType,
                            [hType]: { link: variableValues[`header_${v}`] || '' }
                        };
                    }
                    const param = { type: 'text', text: variableValues[`header_${v}`] || '' };
                    if (isNamed) param.parameter_name = v;
                    return param;
                }),
            });
        }

        if (allVars.body.length > 0) {
            components.push({
                type: 'body',
                parameters: allVars.body.map(v => {
                    const param = { type: 'text', text: variableValues[`body_${v}`] || '' };
                    if (isNamed) param.parameter_name = v;
                    return param;
                }),
            });
        }

        allVars.buttons.forEach(btn => {
            components.push({
                type: 'button',
                sub_type: 'url',
                index: btn.index,
                parameters: btn.variables.map(v => ({
                    type: 'text',
                    text: variableValues[`button_${btn.index}_${v}`] || '',
                })),
            });
        });

        return components.length > 0 ? components : undefined;
    };

    const handleSend = async () => {
        if (allRecipients.length === 0 || !selectedTemplate) return;

        setSending(true);
        try {
            const payload = {
                recipients: allRecipients,
                template_name: selectedTemplate,
                template_language: templateLanguage
            };

            const templateParams = buildTemplateParams();
            if (templateParams) {
                payload.template_params = templateParams;
            }

            await onSend(payload);
            onClose();
        } catch (err) {
            console.error('Broadcast error:', err);
        } finally {
            setSending(false);
        }
    };

    const handleClose = () => {
        if (!sending) {
            onClose();
        }
    };

    const renderVariableInput = (key, label) => (
        <TextField
            key={key}
            label={label}
            placeholder={`أدخل قيمة ${label}`}
            value={variableValues[key] || ''}
            onChange={(e) => handleVariableChange(key, e.target.value)}
            fullWidth
            size="small"
            required
            error={!(variableValues[key]?.trim())}
            sx={{ mb: 1.5 }}
        />
    );

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">إرسال جماعي</Typography>
                <IconButton onClick={handleClose} disabled={sending}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent>
                {/* Step indicator */}
                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                    {[1, 2, 3].map(s => (
                        <Box
                            key={s}
                            sx={{
                                flex: 1,
                                p: 1,
                                borderRadius: 1,
                                bgcolor: step >= s ? 'primary.main' : 'grey.200',
                                color: step >= s ? 'white' : 'text.secondary',
                                textAlign: 'center',
                                cursor: step < s ? 'pointer' : 'default'
                            }}
                            onClick={() => step > s && setStep(s)}
                        >
                            {s === 1 && 'اختيار المستلمين'}
                            {s === 2 && 'اختيار القالب'}
                            {s === 3 && 'مراجعة وإرسال'}
                        </Box>
                    ))}
                </Box>

                {/* Step 1: Select Recipients */}
                {step === 1 && (
                    <Box>
                        <TextField
                            placeholder="بحث عن جهة اتصال..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            fullWidth
                            size="small"
                            sx={{ mb: 2 }}
                        />

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                                جهات الاتصال ({filteredContacts.length})
                            </Typography>
                            <Button size="small" onClick={handleSelectAll}>
                                {selectedContacts.length === filteredContacts.length ? 'إلغاء الكل' : 'اختيار الكل'}
                            </Button>
                        </Box>

                        <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, mb: 2 }}>
                            {filteredContacts.map(contact => (
                                <Box
                                    key={contact.phone}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        p: 1,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        bgcolor: selectedContacts.includes(contact.phone) ? 'action.selected' : 'transparent',
                                        cursor: 'pointer',
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                    onClick={() => handleToggleContact(contact.phone)}
                                >
                                    <Checkbox checked={selectedContacts.includes(contact.phone)} size="small" />
                                    <Box sx={{ ml: 1, flex: 1 }}>
                                        <Typography variant="body2">{contact.profile_name || contact.phone}</Typography>
                                        <Typography variant="caption" color="text.secondary">{contact.phone}</Typography>
                                    </Box>
                                </Box>
                            ))}
                            {filteredContacts.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>لا توجد جهات اتصال</Typography>
                            )}
                        </Box>

                        <TextField
                            label="أرقام إضافية (فاصلة أو سطر جديد)"
                            placeholder="966501234567, 966501234568"
                            value={customNumbers}
                            onChange={(e) => setCustomNumbers(e.target.value)}
                            fullWidth
                            multiline
                            rows={2}
                            helperText="أدخل أرقام إضافية مفصولة بفاصلة أو سطر جديد"
                        />

                        <Typography variant="body2" sx={{ mt: 2 }}>المستلمون المحددون: {allRecipients.length}</Typography>
                    </Box>
                )}

                {/* Step 2: Select Template + Fill Variables */}
                {step === 2 && (
                    <Box>
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>القالب</InputLabel>
                            <Select
                                value={selectedTemplate}
                                onChange={(e) => setSelectedTemplate(e.target.value)}
                                label="القالب"
                            >
                                {templates.map(template => (
                                    <MenuItem key={template.id || template.name} value={template.name}>
                                        {template.name}
                                        {template.status && ` (${template.status})`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>اللغة</InputLabel>
                            <Select
                                value={templateLanguage}
                                onChange={(e) => setTemplateLanguage(e.target.value)}
                                label="اللغة"
                            >
                                <MenuItem value="ar">العربية</MenuItem>
                                <MenuItem value="en">English</MenuItem>
                            </Select>
                        </FormControl>

                        {templateObj && (
                            <Card variant="outlined" sx={{ mb: 2 }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>محتوى القالب</Typography>
                                    {templateObj.header_type === 'text' && templateObj.header_content && (
                                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, direction: 'auto' }}>
                                            {templateObj.header_content}
                                        </Typography>
                                    )}
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'grey.50', p: 1.5, borderRadius: 1, direction: 'auto' }}>
                                        {templateObj.body || 'لا يوجد محتوى'}
                                    </Typography>
                                    {templateObj.footer && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                            {templateObj.footer}
                                        </Typography>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Variable Inputs */}
                        {allVariableKeys.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    هذا القالب يحتوي على {allVariableKeys.length} متغير(ات). يرجى تعبئة القيم أدناه.
                                </Alert>

                                {allVars.header.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>متغيرات العنوان</Typography>
                                        {allVars.header.map(v => renderVariableInput(`header_${v}`, v === 'MEDIA_LINK' ? `رابط ${templateObj?.header_type === 'image' ? 'صورة' : templateObj?.header_type === 'video' ? 'فيديو' : 'مستند'} (URL)` : (/^\d+$/.test(v) ? `عنوان {{${v}}}` : v)) )}
                                    </Box>
                                )}
                                {allVars.body.map(v => renderVariableInput(`body_${v}`, /^\d+$/.test(v) ? `متغير {{${v}}}` : v))}
                                {allVars.buttons.length > 0 && (
                                    <Box sx={{ mt: 2 }}>
                                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>متغيرات الأزرار</Typography>
                                        {allVars.buttons.map(btn =>
                                            btn.variables.map(v => renderVariableInput(`button_${btn.index}_${v}`, /^\d+$/.test(v) ? `زر "${btn.text}" {{${v}}}` : `زر "${btn.text}" ${v}`))
                                        )}
                                    </Box>
                                )}

                                <Card variant="outlined" sx={{ mt: 1, bgcolor: '#e8f5e9' }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>معاينة الرسالة</Typography>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', direction: 'auto' }}>
                                            {previewBody(templateObj?.body, variableValues)}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Box>
                        )}

                        {selectedTemplate && allVariableKeys.length === 0 && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                هذا القالب لا يحتوي على متغيرات. تأكد من أنه معتمد من WhatsApp قبل الإرسال.
                            </Alert>
                        )}
                    </Box>
                )}

                {/* Step 3: Preview */}
                {step === 3 && (
                    <Box>
                        <Typography variant="subtitle1" gutterBottom>ملخص الإرسال</Typography>

                        <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1, mb: 2 }}>
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="body2" color="text.secondary">عدد المستلمين:</Typography>
                                    <Typography variant="h5">{allRecipients.length}</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="body2" color="text.secondary">القالب:</Typography>
                                    <Typography variant="body1">{selectedTemplate}</Typography>
                                </Grid>
                            </Grid>
                        </Box>

                        {templateObj && (
                            <Card variant="outlined" sx={{ mb: 2 }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>الرسالة النهائية</Typography>
                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: '#f0f4f0', p: 1.5, borderRadius: 1, direction: 'auto' }}>
                                        {previewBody(templateObj.body, variableValues)}
                                    </Typography>
                                </CardContent>
                            </Card>
                        )}

                        {allVariableKeys.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>المتغيرات:</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {allVariableKeys.map(key => (
                                        <Chip key={key} label={`${key} = ${variableValues[key] || '—'}`} size="small" color="primary" variant="outlined" />
                                    ))}
                                </Box>
                            </Box>
                        )}

                        <Typography variant="body2" color="text.secondary" gutterBottom>المستلمون:</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 100, overflow: 'auto' }}>
                            {allRecipients.slice(0, 20).map(phone => (
                                <Chip key={phone} label={phone} size="small" />
                            ))}
                            {allRecipients.length > 20 && (
                                <Chip label={`+${allRecipients.length - 20} أخرى`} size="small" />
                            )}
                        </Box>

                        <Alert severity="warning" sx={{ mt: 2 }}>سيتم خصم {allRecipients.length} رصيد من حسابك</Alert>
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
                <Button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1 || sending}>
                    السابق
                </Button>

                <Box sx={{ display: 'flex', gap: 1 }}>
                    {step < 3 ? (
                        <Button
                            variant="contained"
                            onClick={() => setStep(s => s + 1)}
                            disabled={
                                (step === 1 && allRecipients.length === 0) ||
                                (step === 2 && (!selectedTemplate || !allVariablesFilled))
                            }
                        >
                            التالي
                        </Button>
                    ) : (
                        <Button
                            variant="contained"
                            onClick={handleSend}
                            disabled={sending || allRecipients.length === 0}
                            startIcon={sending ? <CircularProgress size={20} /> : <SendIcon />}
                        >
                            {sending ? 'جاري الإرسال...' : `إرسال إلى ${allRecipients.length} مستلم`}
                        </Button>
                    )}
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default BroadcastDialog;