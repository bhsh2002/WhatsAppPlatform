import React, { useState } from 'react';
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
    ToggleButtonGroup,
    ToggleButton,
    Paper,
    Chip,
    CircularProgress,
    Divider
} from '@mui/material';
import {
    Close as CloseIcon,
    SmartButton as ButtonIcon,
    List as ListIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    Send as SendIcon
} from '@mui/icons-material';

const InteractiveMessageDialog = ({ open, onClose, onSend, sending = false }) => {
    const [interactiveType, setInteractiveType] = useState('button');
    const [bodyText, setBodyText] = useState('');
    const [headerText, setHeaderText] = useState('');
    const [footerText, setFooterText] = useState('');

    // Button mode state
    const [buttons, setButtons] = useState([{ id: 'btn_1', title: '' }]);

    // List mode state
    const [listButtonText, setListButtonText] = useState('عرض الخيارات');
    const [sections, setSections] = useState([
        { title: '', rows: [{ id: 'row_1', title: '', description: '' }] }
    ]);

    const resetForm = () => {
        setInteractiveType('button');
        setBodyText('');
        setHeaderText('');
        setFooterText('');
        setButtons([{ id: 'btn_1', title: '' }]);
        setListButtonText('عرض الخيارات');
        setSections([{ title: '', rows: [{ id: 'row_1', title: '', description: '' }] }]);
    };

    const handleClose = () => {
        if (!sending) {
            resetForm();
            onClose();
        }
    };

    // Button handlers
    const addButton = () => {
        if (buttons.length >= 3) return;
        setButtons(prev => [...prev, { id: `btn_${prev.length + 1}`, title: '' }]);
    };

    const removeButton = (index) => {
        if (buttons.length <= 1) return;
        setButtons(prev => prev.filter((_, i) => i !== index));
    };

    const updateButton = (index, title) => {
        setButtons(prev => prev.map((b, i) => i === index ? { ...b, title } : b));
    };

    // Section handlers
    const addSection = () => {
        setSections(prev => [...prev, {
            title: '',
            rows: [{ id: `row_${Date.now()}`, title: '', description: '' }]
        }]);
    };

    const removeSection = (index) => {
        if (sections.length <= 1) return;
        setSections(prev => prev.filter((_, i) => i !== index));
    };

    const updateSectionTitle = (index, title) => {
        setSections(prev => prev.map((s, i) => i === index ? { ...s, title } : s));
    };

    const addRow = (sectionIndex) => {
        setSections(prev => prev.map((s, i) => {
            if (i !== sectionIndex) return s;
            return { ...s, rows: [...s.rows, { id: `row_${Date.now()}`, title: '', description: '' }] };
        }));
    };

    const removeRow = (sectionIndex, rowIndex) => {
        setSections(prev => prev.map((s, i) => {
            if (i !== sectionIndex) return s;
            if (s.rows.length <= 1) return s;
            return { ...s, rows: s.rows.filter((_, j) => j !== rowIndex) };
        }));
    };

    const updateRow = (sectionIndex, rowIndex, field, value) => {
        setSections(prev => prev.map((s, i) => {
            if (i !== sectionIndex) return s;
            return {
                ...s, rows: s.rows.map((r, j) => {
                    if (j !== rowIndex) return r;
                    return { ...r, [field]: value };
                })
            };
        }));
    };

    const isValid = () => {
        if (!bodyText.trim()) return false;
        if (interactiveType === 'button') {
            return buttons.every(b => b.title.trim().length > 0) && buttons.length >= 1;
        }
        if (interactiveType === 'list') {
            return sections.every(s =>
                s.title.trim().length > 0 &&
                s.rows.every(r => r.id.trim().length > 0 && r.title.trim().length > 0)
            );
        }
        return false;
    };

    const handleSend = () => {
        if (!isValid() || sending) return;

        const data = {
            interactive_type: interactiveType,
            body_text: bodyText.trim(),
            header_text: headerText.trim() || undefined,
            footer_text: footerText.trim() || undefined,
        };

        if (interactiveType === 'button') {
            data.buttons = buttons.map(b => ({ id: b.id, title: b.title.trim() }));
        } else {
            data.list_button_text = listButtonText.trim() || 'عرض الخيارات';
            data.sections = sections.map(s => ({
                title: s.title.trim(),
                rows: s.rows.map(r => ({
                    id: r.id.trim(),
                    title: r.title.trim(),
                    description: r.description.trim()
                }))
            }));
        }

        onSend(data);
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                إرسال رسالة تفاعلية
                <IconButton onClick={handleClose} disabled={sending} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', gap: 3 }}>
                {/* Form Section */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Type Selector */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom>نوع الرسالة</Typography>
                        <ToggleButtonGroup
                            value={interactiveType}
                            exclusive
                            onChange={(_, val) => val && setInteractiveType(val)}
                            size="small"
                            fullWidth
                        >
                            <ToggleButton value="button">
                                <ButtonIcon sx={{ mr: 0.5 }} /> أزرار
                            </ToggleButton>
                            <ToggleButton value="list">
                                <ListIcon sx={{ mr: 0.5 }} /> قائمة
                            </ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    {/* Header */}
                    <TextField
                        label="العنوان (اختياري)"
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        size="small"
                        fullWidth
                        inputProps={{ maxLength: 60 }}
                        helperText={`${headerText.length}/60`}
                    />

                    {/* Body */}
                    <TextField
                        label="نص الرسالة *"
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                        size="small"
                        fullWidth
                        multiline
                        rows={3}
                        required
                        inputProps={{ maxLength: 1024 }}
                        helperText={`${bodyText.length}/1024`}
                    />

                    {/* Footer */}
                    <TextField
                        label="التذييل (اختياري)"
                        value={footerText}
                        onChange={(e) => setFooterText(e.target.value)}
                        size="small"
                        fullWidth
                        inputProps={{ maxLength: 60 }}
                        helperText={`${footerText.length}/60`}
                    />

                    <Divider />

                    {/* Buttons Configuration */}
                    {interactiveType === 'button' && (
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="subtitle2">الأزرار ({buttons.length}/3)</Typography>
                                <Button
                                    size="small"
                                    startIcon={<AddIcon />}
                                    onClick={addButton}
                                    disabled={buttons.length >= 3}
                                >
                                    إضافة زر
                                </Button>
                            </Box>
                            {buttons.map((btn, index) => (
                                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                                    <Chip label={index + 1} size="small" color="primary" variant="outlined" />
                                    <TextField
                                        size="small"
                                        placeholder="نص الزر"
                                        value={btn.title}
                                        onChange={(e) => updateButton(index, e.target.value)}
                                        fullWidth
                                        inputProps={{ maxLength: 20 }}
                                    />
                                    <IconButton
                                        size="small"
                                        onClick={() => removeButton(index)}
                                        disabled={buttons.length <= 1}
                                        color="error"
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* List Configuration */}
                    {interactiveType === 'list' && (
                        <Box>
                            <TextField
                                label="نص زر القائمة"
                                value={listButtonText}
                                onChange={(e) => setListButtonText(e.target.value)}
                                size="small"
                                fullWidth
                                sx={{ mb: 2 }}
                                inputProps={{ maxLength: 20 }}
                            />

                            {sections.map((section, sIdx) => (
                                <Paper key={sIdx} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="caption" fontWeight={600}>
                                            قسم {sIdx + 1}
                                        </Typography>
                                        <IconButton
                                            size="small"
                                            onClick={() => removeSection(sIdx)}
                                            disabled={sections.length <= 1}
                                            color="error"
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Box>

                                    <TextField
                                        size="small"
                                        placeholder="عنوان القسم"
                                        value={section.title}
                                        onChange={(e) => updateSectionTitle(sIdx, e.target.value)}
                                        fullWidth
                                        sx={{ mb: 1 }}
                                    />

                                    {section.rows.map((row, rIdx) => (
                                        <Box key={rIdx} sx={{ ml: 2, mb: 1, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                            <Box sx={{ flex: 1 }}>
                                                <TextField
                                                    size="small"
                                                    placeholder="عنوان العنصر"
                                                    value={row.title}
                                                    onChange={(e) => updateRow(sIdx, rIdx, 'title', e.target.value)}
                                                    fullWidth
                                                    sx={{ mb: 0.5 }}
                                                    inputProps={{ maxLength: 24 }}
                                                />
                                                <TextField
                                                    size="small"
                                                    placeholder="الوصف (اختياري)"
                                                    value={row.description}
                                                    onChange={(e) => updateRow(sIdx, rIdx, 'description', e.target.value)}
                                                    fullWidth
                                                    inputProps={{ maxLength: 72 }}
                                                />
                                            </Box>
                                            <IconButton
                                                size="small"
                                                onClick={() => removeRow(sIdx, rIdx)}
                                                disabled={section.rows.length <= 1}
                                                color="error"
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    ))}

                                    <Button size="small" onClick={() => addRow(sIdx)} startIcon={<AddIcon />}>
                                        إضافة عنصر
                                    </Button>
                                </Paper>
                            ))}

                            <Button size="small" onClick={addSection} startIcon={<AddIcon />} variant="outlined">
                                إضافة قسم
                            </Button>
                        </Box>
                    )}
                </Box>

                {/* Preview Section */}
                <Box sx={{ width: 280, flexShrink: 0 }}>
                    <Typography variant="subtitle2" gutterBottom>معاينة</Typography>
                    <Paper elevation={1} sx={{
                        p: '8px 12px',
                        bgcolor: '#d9fdd3',
                        borderRadius: 2,
                        borderTopRightRadius: 0,
                        minWidth: 200
                    }}>
                        {headerText && (
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                                {headerText}
                            </Typography>
                        )}
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                            {bodyText || 'نص الرسالة...'}
                        </Typography>
                        {footerText && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                                {footerText}
                            </Typography>
                        )}

                        {interactiveType === 'button' && (
                            <Box sx={{ mt: 1, borderTop: '1px solid rgba(0,0,0,0.1)', pt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {buttons.map((btn, i) => (
                                    <Box key={i} sx={{
                                        bgcolor: 'rgba(0,0,0,0.05)',
                                        p: 0.6,
                                        borderRadius: 1,
                                        textAlign: 'center',
                                        fontSize: '0.8rem',
                                        color: 'primary.main',
                                        fontWeight: 500
                                    }}>
                                        {btn.title || `زر ${i + 1}`}
                                    </Box>
                                ))}
                            </Box>
                        )}

                        {interactiveType === 'list' && (
                            <Box sx={{ mt: 1, borderTop: '1px solid rgba(0,0,0,0.1)', pt: 1 }}>
                                <Box sx={{
                                    bgcolor: 'rgba(0,0,0,0.05)',
                                    p: 0.6,
                                    borderRadius: 1,
                                    textAlign: 'center',
                                    fontSize: '0.8rem',
                                    color: 'primary.main',
                                    fontWeight: 500,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 0.5
                                }}>
                                    <ListIcon fontSize="small" />
                                    {listButtonText || 'عرض الخيارات'}
                                </Box>
                            </Box>
                        )}
                    </Paper>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={sending}>إلغاء</Button>
                <Button
                    variant="contained"
                    onClick={handleSend}
                    disabled={!isValid() || sending}
                    startIcon={sending ? <CircularProgress size={16} /> : <SendIcon />}
                >
                    {sending ? 'جاري الإرسال...' : 'إرسال'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InteractiveMessageDialog;
