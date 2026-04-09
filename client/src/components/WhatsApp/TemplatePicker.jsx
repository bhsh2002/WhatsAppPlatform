import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemText,
    TextField,
    Box,
    Typography,
    Chip,
    InputAdornment,
    IconButton,
    Paper,
    Divider
} from '@mui/material';
import { Search as SearchIcon, Close as CloseIcon, Description as TemplateIcon } from '@mui/icons-material';

const TemplatePicker = ({ open, onClose, onSelect, templates = [] }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [variables, setVariables] = useState({});

    // Reset state when opening
    useEffect(() => {
        if (open) {
            setSearchTerm('');
            setSelectedTemplate(null);
            setVariables({});
        }
    }, [open]);

    // Filter templates
    const filteredTemplates = templates.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        t.status === 'approved' // Only show approved templates
    );

    // Extract variables from template components
    const getTemplateVariables = (template) => {
        const vars = {
            header: [],
            body: [],
            buttons: []
        };

        if (!template.components) return vars;

        // Ensure components is an array (it might be JSON string from DB)
        let components = template.components;
        if (typeof components === 'string') {
            try {
                components = JSON.parse(components);
            } catch (_e) {
                return vars;
            }
        }

        components.forEach(comp => {
            if (comp.type === 'HEADER' && comp.format === 'TEXT') {
                const matches = comp.text.match(/{{(\d+)}}/g);
                if (matches) {
                    vars.header = matches.map(m => m.replace(/{{|}}/g, ''));
                }
            }
            if (comp.type === 'BODY') {
                const matches = comp.text.match(/{{(\d+)}}/g);
                if (matches) {
                    vars.body = matches.map(m => m.replace(/{{|}}/g, ''));
                }
            }
        });

        return vars;
    };

    const handleTemplateClick = (template) => {
        setSelectedTemplate(template);
        setVariables({});
    };

    const handleVariableChange = (section, index, value) => {
        setVariables(prev => ({
            ...prev,
            [`${section}_${index}`]: value
        }));
    };

    const handleSend = () => {
        if (!selectedTemplate) return;

        // Construct parameters
        const templateVars = getTemplateVariables(selectedTemplate);
        const parameters = [];

        // Header params
        if (templateVars.header.length > 0) {
            const headerParams = templateVars.header.map((_, idx) => ({
                type: 'text',
                text: variables[`header_${idx + 1}`] || ''
            }));
            parameters.push({ type: 'header', parameters: headerParams });
        }

        // Body params
        if (templateVars.body.length > 0) {
            const bodyParams = templateVars.body.map((_, idx) => ({
                type: 'text',
                text: variables[`body_${idx + 1}`] || ''
            }));
            parameters.push({ type: 'body', parameters: bodyParams });
        }

        onSelect({
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            language: { code: selectedTemplate.language || 'ar' },
            components: parameters,
            // Pass full template data for local display/storage optimization
            _templateData: {
                name: selectedTemplate.name,
                language: selectedTemplate.language,
                header: selectedTemplate.header_type === 'text' ? { type: 'text', text: selectedTemplate.header_content } : null,
                body: selectedTemplate.body, // This is raw text with {{1}}
                footer: selectedTemplate.footer,
                buttons: selectedTemplate.buttons
            }
        });
        onClose();
    };

    // Helper to render preview with replaced variables
    const renderPreview = (text, type) => {
        if (!text) return '';
        return text.replace(/{{(\d+)}}/g, (match, number) => {
            const val = variables[`${type}_${number}`];
            return val ? `[${val}]` : match;
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                اختيار قالب رسالة
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ height: '60vh', p: 0, display: 'flex' }}>
                {/* List Section */}
                <Box sx={{ width: '40%', borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0' }}>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="بحث عن قالب..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            InputProps={{
                                startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
                            }}
                        />
                    </Box>
                    <List sx={{ flex: 1, overflowY: 'auto' }}>
                        {filteredTemplates.map((template) => (
                            <ListItem
                                key={template.id}
                                button
                                selected={selectedTemplate?.id === template.id}
                                onClick={() => handleTemplateClick(template)}
                            >
                                <ListItemText
                                    primary={template.name}
                                    secondary={template.category}
                                    sx={{
                                        '& .MuiListItemText-primary': { fontWeight: 500 },
                                        '& .MuiListItemText-secondary': { fontSize: '0.75rem' }
                                    }}
                                />
                                <Chip label={template.language} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                            </ListItem>
                        ))}
                        {filteredTemplates.length === 0 && (
                            <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                                لا توجد قوالب متاحة
                            </Box>
                        )}
                    </List>
                </Box>

                {/* Details & Preview Section */}
                <Box sx={{ width: '60%', p: 3, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                    {selectedTemplate ? (
                        <>
                            <Typography variant="h6" gutterBottom>{selectedTemplate.name}</Typography>

                            {/* Preview Card */}
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: '#d9fdd3', mb: 3, borderRadius: 2, maxWidth: '80%' }}>
                                {getTemplateVariables(selectedTemplate).header.length > 0 && (
                                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                        {renderPreview(JSON.parse(selectedTemplate.components || '[]').find(c => c.type === 'HEADER')?.text || '', 'header')}
                                    </Typography>
                                )}

                                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {renderPreview(selectedTemplate.body, 'body')}
                                </Typography>

                                {selectedTemplate.footer && (
                                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                        {selectedTemplate.footer}
                                    </Typography>
                                )}

                                {selectedTemplate.buttons && (
                                    <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                        {(() => {
                                            try {
                                                const btns = typeof selectedTemplate.buttons === 'string'
                                                    ? JSON.parse(selectedTemplate.buttons)
                                                    : selectedTemplate.buttons;
                                                return Array.isArray(btns) ? btns.map((b, i) => (
                                                    <Chip key={i} label={b.text} color="primary" variant="outlined" size="small" />
                                                )) : null;
                                            } catch (_e) { return null; }
                                        })()}
                                    </Box>
                                )}
                            </Paper>

                            <Divider sx={{ mb: 3 }} />

                            {/* Variables Inputs */}
                            <Typography variant="subtitle2" gutterBottom>ملء المتغيرات</Typography>

                            {getTemplateVariables(selectedTemplate).header.map((v, i) => (
                                <TextField
                                    key={`h_${i}`}
                                    label={`Header Variable {{${v}}}`}
                                    fullWidth
                                    size="small"
                                    sx={{ mb: 2 }}
                                    value={variables[`header_${v}`] || ''}
                                    onChange={(e) => handleVariableChange('header', v, e.target.value)}
                                />
                            ))}

                            {getTemplateVariables(selectedTemplate).body.map((v, i) => (
                                <TextField
                                    key={`b_${i}`}
                                    label={`Body Variable {{${v}}}`}
                                    fullWidth
                                    size="small"
                                    sx={{ mb: 2 }}
                                    value={variables[`body_${v}`] || ''}
                                    onChange={(e) => handleVariableChange('body', v, e.target.value)}
                                />
                            ))}

                            {getTemplateVariables(selectedTemplate).header.length === 0 && getTemplateVariables(selectedTemplate).body.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    هذا القالب لا يحتوي على متغيرات.
                                </Typography>
                            )}

                        </>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
                            <TemplateIcon sx={{ fontSize: 40, mb: 2, opacity: 0.5 }} />
                            <Typography>اختر قالباً لعرض التفاصيل</Typography>
                        </Box>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>إلغاء</Button>
                <Button
                    variant="contained"
                    onClick={handleSend}
                    disabled={!selectedTemplate}
                >
                    إرسال القالب
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TemplatePicker;
