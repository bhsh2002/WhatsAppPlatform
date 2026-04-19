import React from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Chip,
    CircularProgress,
} from '@mui/material';
import {
    Send as SendIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    ArrowBack as ArrowBackIcon,
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
    getDisplayName,
    formatTime: formatTimeProp,
}) => {
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
    const fTime = formatTimeProp || formatTime;
    const fGetDateKey = getDateKey;

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendMessage(newMessage);
        }
    };

    let lastDateKey = null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
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
        </Box>
    );
};

export default UnifiedChatWindow;