import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Avatar,
    TextField,
    Paper,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Badge,
    InputAdornment,
    CircularProgress,
    Chip
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    MoreVert as MoreVertIcon,
    Search as SearchIcon,
    AttachFile as AttachFileIcon,
    Send as SendIcon,
    Mic as MicIcon,
    InsertEmoticon as EmojiIcon,
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon,
    Error as ErrorIcon,
    Description as TemplateIcon
} from '@mui/icons-material';
import api from '../../api';

import TemplatePicker from '../../components/WhatsApp/TemplatePicker';
import MessageBubble from '../../components/WhatsApp/MessageBubble'; // Use shared component

const TenantChat = () => {
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showMobileChat, setShowMobileChat] = useState(false);

    // Template State
    const [templates, setTemplates] = useState([]);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);

    useEffect(() => {
        fetchConversations();
        fetchTemplates();
    }, []);

    useEffect(() => {
        if (selectedChat) {
            fetchMessages(selectedChat.contact);
        }
    }, [selectedChat]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const fetchConversations = async () => {
        try {
            setLoading(true);
            const data = await api.getPortalConversations();
            setConversations(data);
        } catch (err) {
            console.error('Failed to fetch conversations:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchTemplates = async () => {
        try {
            const data = await api.getPortalTemplates();
            setTemplates(data || []);
        } catch (err) {
            console.error('Failed to fetch templates:', err);
        }
    };

    const fetchMessages = async (phone) => {
        try {
            setLoadingMessages(true);
            const data = await api.getPortalMessages(phone);
            setMessages(data);
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            setLoadingMessages(false);
        }
    };

    const handleSendMessage = async (e) => {
        e?.preventDefault();
        if (!newMessage.trim() || !selectedChat || sending) return;

        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedChat.contact,
                type: 'text',
                message: newMessage.trim()
            });
            setNewMessage('');
            fetchMessages(selectedChat.contact);
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            setSending(false);
        }
    };

    const handleSendTemplate = async (templateData) => {
        if (!selectedChat || sending) return;

        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedChat.contact,
                type: 'template',
                templateId: templateData.id,
                components: templateData.components // Pass user params
            });
            fetchMessages(selectedChat.contact);
        } catch (err) {
            console.error('Failed to send template:', err);
            alert('فشل إرسال القالب');
        } finally {
            setSending(false);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const formatTime = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'اليوم';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'أمس';
        }
        return date.toLocaleDateString('ar-SA');
    };

    const getDateKey = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ar-SA');
    };

    const getDisplayName = (contact) => {
        return contact?.profile_name || contact?.contact || 'مجهول';
    };

    const getStatusIcon = (status, direction) => {
        if (direction === 'incoming') return null;

        switch (status) {
            case 'read':
                return <DoneAllIcon sx={{ fontSize: 14, color: '#53bdeb' }} />;
            case 'delivered':
                return <DoneAllIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            case 'sent':
                return <DoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            case 'pending':
                return <ScheduleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            case 'failed':
                return <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />;
            default:
                return <DoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
        }
    };

    // Helper to get media URL (reusing admin API for now passed via props or context usually, but here accessing directly)
    // Note: Tenant needs their own media download endpoint if sensitive, but for now assuming shared or public-ish handling
    const getMediaDownloadUrl = (mediaId) => {
        // Implementation might need adjustment for tenant portal auth
        return `/api/media/${mediaId}`; // Placeholder
    };

    const filteredConversations = conversations.filter(conv =>
        (conv.profile_name || conv.contact || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Box sx={{ height: '100%', display: 'flex', bgcolor: 'background.default' }}>
            {/* Conversations List */}
            <Box sx={{
                width: { xs: showMobileChat ? 0 : '100%', md: 350 },
                display: { xs: showMobileChat ? 'none' : 'flex', md: 'flex' },
                flexDirection: 'column',
                borderRight: '1px solid rgba(0,0,0,0.1)',
                bgcolor: 'background.paper'
            }}>
                {/* Search Header */}
                <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                        المحادثات
                    </Typography>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="بحث..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                </Box>

                {/* Conversations */}
                <Box sx={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress size={32} />
                        </Box>
                    ) : filteredConversations.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            <Typography>لا توجد محادثات</Typography>
                        </Box>
                    ) : (
                        <List disablePadding>
                            {filteredConversations.map((conv) => (
                                <ListItem
                                    key={conv.contact}
                                    component="div"
                                    onClick={() => {
                                        setSelectedChat(conv);
                                        setShowMobileChat(true);
                                    }}
                                    sx={{
                                        cursor: 'pointer',
                                        borderBottom: '1px solid rgba(0,0,0,0.05)',
                                        bgcolor: selectedChat?.contact === conv.contact ? 'action.selected' : 'transparent',
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                >
                                    <ListItemAvatar>
                                        <Badge
                                            badgeContent={conv.unread_count}
                                            color="success"
                                            overlap="circular"
                                        >
                                            <Avatar sx={{ bgcolor: 'primary.main' }}>
                                                {(conv.profile_name || conv.contact || '?')[0].toUpperCase()}
                                            </Avatar>
                                        </Badge>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={conv.profile_name || conv.contact}
                                        secondary={
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                                {conv.last_message?.substring(0, 30)}...
                                            </Typography>
                                        }
                                        primaryTypographyProps={{ fontWeight: conv.unread_count ? 700 : 400, noWrap: true }}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {formatDate(conv.last_interaction)}
                                    </Typography>
                                </ListItem>
                            ))}
                        </List>
                    )}
                </Box>
            </Box>

            {/* Chat Window */}
            <Box sx={{
                flex: 1,
                display: { xs: showMobileChat ? 'flex' : 'none', md: 'flex' },
                flexDirection: 'column',
                bgcolor: '#efeae2'
            }}>
                {!selectedChat ? (
                    <Box sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        bgcolor: 'background.default',
                        color: 'text.secondary'
                    }}>
                        <Typography variant="h6" gutterBottom>اختر محادثة للبدء</Typography>
                        <Typography variant="body2">حدد جهة اتصال من القائمة لعرض المحادثة</Typography>
                    </Box>
                ) : (
                    <>
                        {/* Chat Header */}
                        <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
                            <Toolbar sx={{ px: 1 }}>
                                <IconButton
                                    onClick={() => setShowMobileChat(false)}
                                    sx={{ mr: 1, display: { md: 'none' } }}
                                >
                                    <ArrowBackIcon />
                                </IconButton>

                                <Avatar sx={{ width: 40, height: 40, mr: 1.5, bgcolor: 'primary.main' }}>
                                    {getDisplayName(selectedChat)[0].toUpperCase()}
                                </Avatar>

                                <Box sx={{ flex: 1 }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                                        {getDisplayName(selectedChat)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {selectedChat.contact}
                                    </Typography>
                                </Box>

                                <IconButton><SearchIcon /></IconButton>
                                <IconButton><MoreVertIcon /></IconButton>
                            </Toolbar>
                        </AppBar>

                        {/* Messages Area */}
                        <Box
                            ref={messagesContainerRef}
                            sx={{
                                flex: 1,
                                overflowY: 'auto',
                                p: 2,
                                backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                                backgroundRepeat: 'repeat',
                                backgroundSize: '400px',
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            {loadingMessages ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                    <Typography variant="body2" sx={{ bgcolor: 'background.paper', px: 2, py: 0.5, borderRadius: 4, boxShadow: 1 }}>
                                        جاري تحميل الرسائل...
                                    </Typography>
                                </Box>
                            ) : (
                                messages.map((msg, idx) => {
                                    const prevMsg = messages[idx - 1];
                                    const showDateSeparator = !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg?.created_at);

                                    return (
                                        <React.Fragment key={msg.id || idx}>
                                            {showDateSeparator && (
                                                <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                                                    <Typography variant="caption" sx={{ bgcolor: 'secondary.light', color: 'secondary.contrastText', px: 1.5, py: 0.5, borderRadius: 2, opacity: 0.9 }}>
                                                        {getDateKey(msg.created_at)}
                                                    </Typography>
                                                </Box>
                                            )}
                                            <MessageBubble
                                                message={msg}
                                                isOutgoing={msg.direction === 'outgoing'}
                                                formatTime={formatTime}
                                                getStatusIcon={getStatusIcon}
                                                getMediaDownloadUrl={getMediaDownloadUrl}
                                            />
                                        </React.Fragment>
                                    );
                                })
                            )}
                            <div ref={messagesEndRef} />
                        </Box>

                        {/* Input Area */}
                        <Paper elevation={0} sx={{
                            p: 1,
                            bgcolor: 'background.default',
                            borderTop: '1px solid rgba(0,0,0,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                        }}>
                            <IconButton><EmojiIcon /></IconButton>
                            <IconButton onClick={() => setShowTemplatePicker(true)}>
                                <TemplateIcon />
                            </IconButton>
                            <IconButton><AttachFileIcon sx={{ transform: 'rotate(45deg)' }} /></IconButton>

                            <Box component="form" onSubmit={handleSendMessage} sx={{ flex: 1, display: 'flex', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    placeholder="اكتب رسالة..."
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    multiline
                                    maxRows={4}
                                    sx={{
                                        bgcolor: 'background.paper',
                                        '& .MuiOutlinedInput-root': { borderRadius: 2 }
                                    }}
                                />

                                {newMessage.trim() ? (
                                    <IconButton
                                        type="submit"
                                        disabled={sending}
                                        sx={{
                                            bgcolor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { bgcolor: 'primary.dark' },
                                            '&:disabled': { bgcolor: 'action.disabled' }
                                        }}
                                    >
                                        {sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                                    </IconButton>
                                ) : (
                                    <IconButton><MicIcon /></IconButton>
                                )}
                            </Box>
                        </Paper>

                        {/* Template Picker */}
                        <TemplatePicker
                            open={showTemplatePicker}
                            onClose={() => setShowTemplatePicker(false)}
                            onSelect={handleSendTemplate}
                            templates={templates}
                        />
                    </>
                )}
            </Box>
        </Box>
    );
};

export default TenantChat;
