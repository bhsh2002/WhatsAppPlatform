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
    CardContent
} from '@mui/material';
import {
    Close as CloseIcon,
    Send as SendIcon,
    Add as AddIcon,
    Delete as DeleteIcon
} from '@mui/icons-material';

/**
 * Extract variable placeholders from template body text.
 * Returns sorted unique variable numbers, e.g. [1, 2, 3]
 */
function extractVariables(bodyText) {
    if (!bodyText) return [];
    const matches = bodyText.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    const nums = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))];
    return nums.sort((a, b) => a - b);
}

/**
 * Replace {{N}} placeholders with actual values for preview.
 */
function previewBody(bodyText, variableValues) {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{(\d+)\}\}/g, (match, num) => {
        const val = variableValues[parseInt(num)];
        return val ? val : match;
    });
}

const BroadcastDialog = ({ 
    open, 
    onClose, 
    onSend, 
    contacts = [], 
    templates = [],
    loading = false 
}) => {
    const [step, setStep] = useState(1); // 1: select recipients, 2: select template & variables, 3: preview
    const [selectedContacts, setSelectedContacts] = useState([]);
    const [customNumbers, setCustomNumbers] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [templateLanguage, setTemplateLanguage] = useState('ar');
    const [searchTerm, setSearchTerm] = useState('');
    const [sending, setSending] = useState(false);
    const [variableValues, setVariableValues] = useState({}); // { 1: 'value1', 2: 'value2', ... }

    // Find the full template object
    const templateObj = useMemo(() => 
        templates.find(t => t.name === selectedTemplate),
        [templates, selectedTemplate]
    );

    // Extract variables from the selected template body
    const variables = useMemo(() => 
        extractVariables(templateObj?.body),
        [templateObj]
    );

    // Check if all variables are filled
    const allVariablesFilled = useMemo(() => 
        variables.length === 0 || variables.every(v => variableValues[v]?.trim()),
        [variables, variableValues]
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

    // Reset variable values when template changes
    useEffect(() => {
        setVariableValues({});
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

    const handleVariableChange = (varNum, value) => {
        setVariableValues(prev => ({
            ...prev,
            [varNum]: value
        }));
    };

    /**
     * Build the Meta API template_params (components array) from variable values.
     */
    const buildTemplateParams = () => {
        if (variables.length === 0) return undefined;
        return [
            {
                type: 'body',
                parameters: variables.map(v => ({
                    type: 'text',
                    text: variableValues[v] || ''
                }))
            }
        ];
    };

    const handleSend = async () => {
        if (allRecipients.length === 0) {
            return;
        }
        if (!selectedTemplate) {
            return;
        }

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

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                    إرسال جماعي
                </Typography>
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

                        <Box sx={{ 
                            maxHeight: 300, 
                            overflow: 'auto', 
                            border: 1, 
                            borderColor: 'divider', 
                            borderRadius: 1,
                            mb: 2 
                        }}>
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
                                    <Checkbox
                                        checked={selectedContacts.includes(contact.phone)}
                                        size="small"
                                    />
                                    <Box sx={{ ml: 1, flex: 1 }}>
                                        <Typography variant="body2">
                                            {contact.profile_name || contact.phone}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {contact.phone}
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                            {filteredContacts.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                                    لا توجد جهات اتصال
                                </Typography>
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

                        <Typography variant="body2" sx={{ mt: 2 }}>
                            المستلمون المحددون: {allRecipients.length}
                        </Typography>
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
                                <MenuItem value="en_US">English (US)</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Template body preview */}
                        {templateObj && (
                            <Card variant="outlined" sx={{ mb: 2 }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        محتوى القالب
                                    </Typography>
                                    <Typography 
                                        variant="body2" 
                                        sx={{ 
                                            whiteSpace: 'pre-wrap', 
                                            bgcolor: 'grey.50', 
                                            p: 1.5, 
                                            borderRadius: 1,
                                            direction: 'auto'
                                        }}
                                    >
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
                        {variables.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    هذا القالب يحتوي على {variables.length} متغير(ات). يرجى تعبئة القيم أدناه.
                                </Alert>
                                
                                {variables.map(varNum => (
                                    <TextField
                                        key={varNum}
                                        label={`متغير {{${varNum}}}`}
                                        placeholder={`أدخل قيمة المتغير {{${varNum}}}`}
                                        value={variableValues[varNum] || ''}
                                        onChange={(e) => handleVariableChange(varNum, e.target.value)}
                                        fullWidth
                                        size="small"
                                        required
                                        error={!variableValues[varNum]?.trim()}
                                        helperText={!variableValues[varNum]?.trim() ? 'هذا الحقل مطلوب' : ''}
                                        sx={{ mb: 1.5 }}
                                    />
                                ))}

                                {/* Live preview with substituted variables */}
                                <Card variant="outlined" sx={{ mt: 1, bgcolor: '#e8f5e9' }}>
                                    <CardContent>
                                        <Typography variant="subtitle2" color="success.dark" gutterBottom>
                                            معاينة الرسالة بعد تعبئة المتغيرات
                                        </Typography>
                                        <Typography 
                                            variant="body2" 
                                            sx={{ 
                                                whiteSpace: 'pre-wrap', 
                                                direction: 'auto' 
                                            }}
                                        >
                                            {previewBody(templateObj?.body, variableValues)}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Box>
                        )}

                        {selectedTemplate && variables.length === 0 && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                هذا القالب لا يحتوي على متغيرات. تأكد من أنه معتمد من WhatsApp قبل الإرسال.
                            </Alert>
                        )}
                    </Box>
                )}

                {/* Step 3: Preview */}
                {step === 3 && (
                    <Box>
                        <Typography variant="subtitle1" gutterBottom>
                            ملخص الإرسال
                        </Typography>

                        <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1, mb: 2 }}>
                            <Grid container spacing={2}>
                                <Grid item xs={6}>
                                    <Typography variant="body2" color="text.secondary">
                                        عدد المستلمين:
                                    </Typography>
                                    <Typography variant="h5">
                                        {allRecipients.length}
                                    </Typography>
                                </Grid>
                                <Grid item xs={6}>
                                    <Typography variant="body2" color="text.secondary">
                                        القالب:
                                    </Typography>
                                    <Typography variant="body1">
                                        {selectedTemplate}
                                    </Typography>
                                </Grid>
                            </Grid>
                        </Box>

                        {/* Show final message preview with variables */}
                        {templateObj && (
                            <Card variant="outlined" sx={{ mb: 2 }}>
                                <CardContent>
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        الرسالة النهائية
                                    </Typography>
                                    <Typography 
                                        variant="body2" 
                                        sx={{ 
                                            whiteSpace: 'pre-wrap', 
                                            bgcolor: '#f0f4f0', 
                                            p: 1.5, 
                                            borderRadius: 1,
                                            direction: 'auto'
                                        }}
                                    >
                                        {previewBody(templateObj.body, variableValues)}
                                    </Typography>
                                </CardContent>
                            </Card>
                        )}

                        {/* Variable summary */}
                        {variables.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>
                                    المتغيرات:
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {variables.map(v => (
                                        <Chip 
                                            key={v}
                                            label={`{{${v}}} = ${variableValues[v] || '—'}`}
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}

                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            المستلمون:
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 100, overflow: 'auto' }}>
                            {allRecipients.slice(0, 20).map(phone => (
                                <Chip key={phone} label={phone} size="small" />
                            ))}
                            {allRecipients.length > 20 && (
                                <Chip label={`+${allRecipients.length - 20} أخرى`} size="small" />
                            )}
                        </Box>

                        <Alert severity="warning" sx={{ mt: 2 }}>
                            سيتم خصم {allRecipients.length} رصيد من حسابك
                        </Alert>
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
                <Button
                    onClick={() => setStep(s => Math.max(1, s - 1))}
                    disabled={step === 1 || sending}
                >
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