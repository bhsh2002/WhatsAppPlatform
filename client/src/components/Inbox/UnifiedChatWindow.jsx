import React, { useState, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Chip,
    Divider,
    Tooltip,
    CircularProgress,
    Alert
} from '@mui/material';
import {
    Send as SendIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    ArrowBack as ArrowBackIcon,
    Check as CheckIcon,
    DoneAll as DoneAllIcon,
    AccessTime as AccessTimeIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import MessageBubble from '../WhatsApp/MessageBubble';
import api from '../../api';

const formatTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
};

const getDateKey = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const defaultGetStatusIcon = (status, direction) => {
    if (direction !== 'outgoing') return null;
    const props = { fontSize: 'inherit' };
    switch (status) {
        case 'read': return <DoneAllIcon {...props} sx={{ color: '#53bdeb', fontSize: 'inherit' }} />;
        case 'delivered': return <DoneAllIcon {...props} />;
        case 'sent': return <CheckIcon {...props} />;
        case 'pending': return <AccessTimeIcon {...props} sx={{ opacity: 0.5 }} />;
        case 'failed': return <ErrorIcon {...props} color="error" />;
        default: return <AccessTimeIcon {...props} />;
    }
};

const defaultGetMediaDownloadUrl = (mediaId, tenantId) => {
    if (!mediaId) return null;
    return api.getMediaDownloadUrl(mediaId, tenantId);
};

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
    getStatusIcon: getStatusIconProp,
    getMediaDownloadUrl: getMediaDownloadUrlProp,
    getDateKey: getDateKeyProp,
    templates,
    onSendTemplate,
    onSendDocument,
    onSendImage,
    onSendInteractive,
    sendingDoc,
    sendingInteractive,
    windowStatus
}) => {
    const isWhatsApp = selectedChat?.channel === 'whatsapp';
    const channelColor = isWhatsApp ? '#25D366' : '#0084ff';
    const channelLabel = isWhatsApp ? 'واتساب' : 'ماسنجر';
    const ChannelIcon = isWhatsApp ? WhatsAppIcon : FacebookIcon;

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
    const fGetDateKey = getDateKeyProp || getDateKey;
    const fGetStatusIcon = getStatusIconProp || defaultGetStatusIcon;
    const fGetMediaUrl = getMediaDownloadUrlProp || defaultGetMediaDownloadUrl;

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
                    sx={{ bgcolor: selectedChat.avatar_url ? undefined : channelColor + '22', mr: 1.5 }}
                >
                    {displayName.charAt(0)?.toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="subtitle1" fontWeight="bold" noWrap>
                            {displayName}
                        </Typography>
                        <Chip
                            icon={<ChannelIcon sx={{ fontSize: 14 }} />}
                            label={channelLabel}
                            size="small"
                            sx={{
                                height: 20,
                                fontSize: 11,
                                borderColor: channelColor,
                                color: channelColor,
                                '& .MuiChip-icon': { color: channelColor },
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
                    bgcolor: isWhatsApp ? '#ece5dd' : '#f0f2f5',
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
                                    <Box sx={{ textAlign: 'center', my: 2 }}>
                                        <Typography variant="caption" sx={{ bgcolor: 'background.paper', px: 2, py: 0.5, borderRadius: 1 }}>
                                            {msg?.created_at ? new Date(msg.created_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                                        </Typography>
                                    </Box>
                                )}
                                {isWhatsApp ? (
                                    <MessageBubble
                                        message={msg}
                                        isOutgoing={msg?.direction === 'outgoing'}
                                        getDisplayName={getDisplayName}
                                        formatTime={fTime}
                                        getStatusIcon={fGetStatusIcon}
                                        getMediaDownloadUrl={fGetMediaUrl}
                                    />
                                ) : (
                                    <MessengerBubble msg={msg} />
                                )}
                            </React.Fragment>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </Box>

            {/* Input area */}
            {windowStatus && !windowStatus.is_open && isWhatsApp && (
                <Alert severity="warning" sx={{ mx: 2, mt: 1 }}>
                    نافذة الرسائل مغلقة. يمكن إرسال القوالب المعتمدة فقط.
                </Alert>
            )}
            <Paper sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }} elevation={0}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                        fullWidth
                        multiline
                        maxRows={4}
                        size="small"
                        placeholder={isWhatsApp ? "اكتب رسالة..." : "اكتب ردًا..."}
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={sending}
                    />
                    <IconButton
                        color="primary"
                        onClick={() => onSendMessage(newMessage)}
                        disabled={sending || !newMessage?.trim()}
                    >
                        {sending ? <CircularProgress size={24} /> : <SendIcon />}
                    </IconButton>
                </Box>
            </Paper>
        </Box>
    );
};

export default UnifiedChatWindow;