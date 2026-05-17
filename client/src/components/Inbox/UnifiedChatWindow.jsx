import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Chip,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    Tooltip,
    Snackbar,
} from '@mui/material';
import {
    Send as SendIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    ArrowBack as ArrowBackIcon,
    Label as LabelIcon,
} from '@mui/icons-material';

const formatTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
};

const getDateKey = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Messenger message bubble
const MessengerBubble = ({ msg }) => {
    const isOutgoing = msg?.direction === 'outgoing';
    const content = msg?.message_text || '';

    return (
        <Box sx={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', mb: 1 }}>
            <Paper sx={{
                maxWidth: '70%',
                p: 1.5,
                bgcolor: isOutgoing ? '#0084ff' : '#f0f0f0',
                color: isOutgoing ? 'white' : 'text.primary',
                borderRadius: 2,
            }}>
                {msg?.attachment_url && (
                    <Box sx={{ mb: content ? 0.5 : 0 }}>
                        {msg?.message_type === 'image' || (msg?.attachment_url && msg?.message_type !== 'file') ? (
                            <img src={msg.attachment_url} alt="" style={{ maxWidth: '100%', borderRadius: 4 }} />
                        ) : (
                            <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer"
                                style={{ color: isOutgoing ? 'white' : '#1976d2', textDecoration: 'underline' }}>
                                📄 ملف مرفق
                            </a>
                        )}
                    </Box>
                )}
                {msg?.sticker_url && (
                    <img src={msg.sticker_url} alt="sticker" style={{ maxWidth: 120 }} />
                )}
                {content && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content}
                    </Typography>
                )}
                <Typography variant="caption" sx={{
                    display: 'block',
                    textAlign: isOutgoing ? 'left' : 'right',
                    mt: 0.25,
                    opacity: 0.7,
                    fontSize: 10,
                }}>
                    {formatTime(msg?.created_at || '')}
                </Typography>
            </Paper>
        </Box>
    );
};

const UnifiedChatWindow = ({
    selectedChat,
    messages,
    loadingMessages,
    onBack,
    onSendMessage,
    newMessage,
    setNewMessage,
    sending,
    messagesEndRef,
    messagesContainerRef,
    // Utility message props
    onSendUtilityMessage,
    getMessageTags,
    utilityFallback, // { text, timestamp } — set by parent on 24h error
}) => {
    // Utility dialog state
    const [utilityOpen, setUtilityOpen] = useState(false);
    const [utilityTags, setUtilityTags] = useState([]);
    const [utilitySelectedTag, setUtilitySelectedTag] = useState('');
    const [utilityMessage, setUtilityMessage] = useState('');
    const [utilitySending, setUtilitySending] = useState(false);
    const [utilityError, setUtilityError] = useState('');
    const [utilityLoadingTags, setUtilityLoadingTags] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const openUtilityDialog = useCallback(async () => {
        if (!getMessageTags) return;
        setUtilityLoadingTags(true);
        setUtilityError('');
        try {
            const data = await getMessageTags();
            setUtilityTags(data?.tags || []);
        } catch {
            setUtilityTags([]);
        } finally {
            setUtilityLoadingTags(false);
        }
        setUtilityOpen(true);
    }, [getMessageTags]);

    // Auto-open utility dialog on fallback (24h window error from parent)
    useEffect(() => {
        if (utilityFallback?.text && utilityFallback?.timestamp) {
            setUtilityMessage(utilityFallback.text);
            setUtilityError('');
            setUtilitySelectedTag('');
            openUtilityDialog();
        }
    }, [openUtilityDialog, utilityFallback?.text, utilityFallback?.timestamp]);

    const handleOpenUtilityManual = useCallback(() => {
        setUtilityMessage(newMessage?.trim() || '');
        setUtilitySelectedTag('');
        setUtilityError('');
        openUtilityDialog();
    }, [newMessage, openUtilityDialog]);

    const handleSendUtility = useCallback(async () => {
        if (!utilitySelectedTag || !utilityMessage?.trim() || !onSendUtilityMessage) return;
        try {
            setUtilitySending(true);
            setUtilityError('');
            await onSendUtilityMessage(utilityMessage.trim(), utilitySelectedTag);
            setUtilityOpen(false);
            setUtilityMessage('');
            setUtilitySelectedTag('');
            setNewMessage('');
            setSnackbar({ open: true, message: 'تم إرسال الرسالة الموسومة بنجاح', severity: 'success' });
        } catch (err) {
            setUtilityError(err.message || 'فشل إرسال الرسالة');
        } finally {
            setUtilitySending(false);
        }
    }, [utilitySelectedTag, utilityMessage, onSendUtilityMessage, setNewMessage]);

    if (!selectedChat) {
        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                width: '100%',
                bgcolor: 'grey.50',
                borderBottom: '4px solid #25D366',
            }}>
                <WhatsAppIcon sx={{ fontSize: 80, color: 'grey.300', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">اختر محادثة للبدء</Typography>
            </Box>
        );
    }

    const displayName = selectedChat.display_name || selectedChat.contact_id || 'غير معروف';
    const fGetDateKey = getDateKey;
    const hasUtilitySupport = !!onSendUtilityMessage && !!getMessageTags;

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendMessage(newMessage);
        }
    };

    let lastDateKey = null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0 }}>
            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                p: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
            }}>
                <IconButton sx={{ display: { md: 'none' } }} onClick={onBack}>
                    <ArrowBackIcon />
                </IconButton>
                <Avatar
                    src={selectedChat.avatar_url || undefined}
                    sx={{ bgcolor: '#0084ff22', mr: 1.5 }}
                >
                    {displayName.charAt(0)?.toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="subtitle1" fontWeight="bold" noWrap>
                            {displayName}
                        </Typography>
                        <Chip
                            icon={<FacebookIcon sx={{ fontSize: 14 }} />}
                            label="ماسنجر"
                            size="small"
                            sx={{
                                height: 20,
                                fontSize: 11,
                                borderColor: '#0084ff',
                                color: '#0084ff',
                                '& .MuiChip-icon': { color: '#0084ff' },
                            }}
                            variant="outlined"
                        />
                    </Box>
                    <Typography variant="caption" color="text.secondary" noWrap>
                        {selectedChat.tenant_name && `${selectedChat.tenant_name} • `}
                        {selectedChat.contact_id}
                        {selectedChat.page_name && ` • ${selectedChat.page_name}`}
                    </Typography>
                </Box>
            </Box>

            {/* Messages */}
            <Box
                ref={messagesContainerRef}
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: 2,
                    bgcolor: '#f0f2f5',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {loadingMessages ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : !messages || messages.length === 0 ? (
                    <Typography textAlign="center" color="text.secondary" sx={{ mt: 4 }}>
                        لا توجد رسائل
                    </Typography>
                ) : (
                    messages.map((msg, idx) => {
                        const dateKey = fGetDateKey(msg?.created_at || '');
                        const showDate = dateKey !== lastDateKey;
                        lastDateKey = dateKey;

                        return (
                            <React.Fragment key={msg?.id || idx}>
                                {showDate && (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                                        <Typography variant="caption" sx={{
                                            bgcolor: 'background.paper',
                                            color: 'text.secondary',
                                            px: 1.5, py: 0.5, borderRadius: 2, opacity: 0.9,
                                        }}>
                                            {msg?.created_at ? new Date(msg.created_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                                        </Typography>
                                    </Box>
                                )}
                                <MessengerBubble msg={msg} />
                            </React.Fragment>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </Box>

            {/* Input area */}
            <Paper sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }} elevation={0}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                    {hasUtilitySupport && (
                        <Tooltip title="رسالة موسومة (خارج نافذة 24 ساعة)" arrow>
                            <IconButton
                                onClick={handleOpenUtilityManual}
                                sx={{
                                    flexShrink: 0,
                                    color: '#7c4dff',
                                    '&:hover': { bgcolor: '#7c4dff14' },
                                }}
                            >
                                <LabelIcon />
                            </IconButton>
                        </Tooltip>
                    )}
                    <TextField
                        fullWidth
                        multiline
                        maxRows={4}
                        size="small"
                        placeholder="اكتب ردًا..."
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={sending}
                        sx={{
                            minWidth: 0,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 4,
                                bgcolor: 'grey.50'
                            }
                        }}
                    />
                    <IconButton
                        onClick={() => onSendMessage(newMessage)}
                        disabled={sending || !newMessage?.trim()}
                        sx={{
                            flexShrink: 0,
                            bgcolor: '#0084ff',
                            color: 'white',
                            '&:hover': { bgcolor: '#006fdd' },
                            '&:disabled': { bgcolor: 'action.disabled', color: 'white' }
                        }}
                    >
                        {sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                    </IconButton>
                </Box>
            </Paper>

            {/* Utility Message Dialog */}
            {hasUtilitySupport && (
                <Dialog open={utilityOpen} onClose={() => setUtilityOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>إرسال رسالة موسومة</DialogTitle>
                    <DialogContent>
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            يمكنك إرسال رسالة خارج نافذة الـ 24 ساعة باستخدام علامة رسالة مناسبة.
                        </Alert>
                        {utilityError && <Alert severity="error" sx={{ mb: 2 }}>{utilityError}</Alert>}

                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>نوع الرسالة</InputLabel>
                            <Select
                                value={utilitySelectedTag}
                                onChange={e => setUtilitySelectedTag(e.target.value)}
                                label="نوع الرسالة"
                                disabled={utilityLoadingTags}
                            >
                                <MenuItem value="" disabled>اختر نوع الرسالة</MenuItem>
                                {utilityTags.map(tag => (
                                    <MenuItem key={tag.value} value={tag.value}>
                                        <Box>
                                            <Typography variant="body2">{tag.label}</Typography>
                                            <Typography variant="caption" color="text.secondary">{tag.description}</Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            maxRows={6}
                            size="small"
                            label="نص الرسالة"
                            value={utilityMessage}
                            onChange={e => setUtilityMessage(e.target.value)}
                            sx={{ mb: 1 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setUtilityOpen(false)}>إلغاء</Button>
                        <Button
                            variant="contained"
                            onClick={handleSendUtility}
                            disabled={utilitySending || !utilitySelectedTag || !utilityMessage?.trim()}
                            startIcon={utilitySending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                        >
                            {utilitySending ? 'جاري الإرسال...' : 'إرسال'}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Snackbar */}
            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default UnifiedChatWindow;
