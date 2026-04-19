import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box,
    Typography,
    useMediaQuery,
    useTheme,
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
    Snackbar,
    CircularProgress
} from '@mui/material';
import {
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon,
    Error as ErrorIcon,
    Send as SendIcon
} from '@mui/icons-material';
import api from '../../api';
import UnifiedSidebar from '../../components/Inbox/UnifiedSidebar';
import UnifiedChatWindow from '../../components/Inbox/UnifiedChatWindow';
import ChatWindow from '../../components/WhatsApp/ChatWindow';

const TenantInbox = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendingDoc, setSendingDoc] = useState(false);
    const [sendingInteractive, setSendingInteractive] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [channelFilter, setChannelFilter] = useState('');
    const [templates, setTemplates] = useState([]);
    const [windowStatus, setWindowStatus] = useState(null);
    const [syncing, setSyncing] = useState(false);

    const [utilityDialogOpen, setUtilityDialogOpen] = useState(false);
    const [utilityTags, setUtilityTags] = useState([]);
    const [utilitySelectedTag, setUtilitySelectedTag] = useState('');
    const [utilityMessageText, setUtilityMessageText] = useState('');
    const [utilitySending, setUtilitySending] = useState(false);
    const [utilityError, setUtilityError] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const selectedChatRef = useRef(null);
    const isFirstLoad = useRef(true);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    // ============================================
    // Data Fetching (Portal-scoped)
    // ============================================

    const fetchConversations = useCallback(async () => {
        try {
            setLoading(true);
            const params = {};
            if (channelFilter) params.channel = channelFilter;
            const data = await api.getPortalUnifiedConversations(params);
            setConversations(data);
        } catch (error) {
            console.error('Failed to fetch conversations:', error);
        } finally {
            setLoading(false);
        }
    }, [channelFilter]);

    useEffect(() => {
        fetchConversations();
        api.getMediaToken();
    }, [fetchConversations]);

    const fetchMessages = useCallback(async (conv) => {
        try {
            if (isFirstLoad.current) setLoadingMessages(true);
            const params = {};
            if (conv.channel === 'messenger') {
                params.conversation_id = conv.conversation_id;
            }
            const data = await api.getPortalUnifiedMessages(conv.channel, conv.contact_id, params);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
            setMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    }, []);

    const fetchTemplates = useCallback(async () => {
        try {
            const data = await api.getPortalTemplates();
            setTemplates(data || []);
        } catch (err) {
            console.error('Failed to fetch templates:', err);
            setTemplates([]);
        }
    }, []);

    const fetchWindowStatus = useCallback(async (contactId) => {
        if (!contactId) {
            setWindowStatus(null);
            return;
        }
        try {
            const data = await api.getWindowStatus(contactId);
            setWindowStatus(data);
        } catch {
            setWindowStatus(null);
        }
    }, []);

    const markAsRead = useCallback(async (msgs, conv) => {
        try {
            if (conv.channel === 'whatsapp') {
                const lastIncoming = msgs.filter(m => m.direction === 'incoming').pop();
                if (lastIncoming?.wamid) {
                    await api.markAsReadPortal({
                        message_id: lastIncoming.wamid,
                    });
                }
            }
            // Messenger mark-as-read is handled by the messages endpoint
        } catch {
            // Best-effort
        }
    }, []);

    // ============================================
    // Chat Selection & Auto-refresh
    // ============================================

    useEffect(() => {
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat).then(() => {
                markAsRead(messages, selectedChat);
            });
            if (selectedChat.channel === 'whatsapp') {
                fetchTemplates();
                fetchWindowStatus(selectedChat.contact_id);
            } else {
                setTemplates([]);
                setWindowStatus(null);
            }
            const interval = setInterval(() => fetchMessages(selectedChat), 15000);
            return () => clearInterval(interval);
        } else {
            setWindowStatus(null);
        }
    }, [selectedChat]);

    const handleSelectChat = useCallback((conv) => {
        setSelectedChat(conv);
        setNewMessage('');
    }, []);

    // Smart scroll
    useEffect(() => {
        if (messages.length === 0) return;

        const container = messagesContainerRef.current;
        if (!container) return;

        if (isFirstLoad.current) {
            container.scrollTop = container.scrollHeight;
            isFirstLoad.current = false;
            return;
        }

        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom < 300) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages]);

    const scrollToBottom = () => {
        setTimeout(() => {
            const container = messagesContainerRef.current;
            if (container) container.scrollTop = container.scrollHeight;
        }, 50);
    };

    // ============================================
    // WhatsApp Send Handlers (Portal API)
    // ============================================

    const handleSendWAMessage = useCallback(async () => {
        if (!newMessage.trim() || !selectedChat || sending) return;
        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedChat.contact_id,
                type: 'text',
                message: newMessage.trim(),
            });
            setNewMessage('');
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send:', err);
        } finally {
            setSending(false);
        }
    }, [newMessage, selectedChat, sending, fetchMessages, fetchConversations]);

    const handleSendTemplate = useCallback(async (templateData) => {
        if (!selectedChat || sending) return;
        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedChat.contact_id,
                type: 'template',
                templateId: templateData.id,
                components: templateData.components,
            });
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send template:', err);
            alert('فشل إرسال القالب');
        } finally {
            setSending(false);
        }
    }, [selectedChat, sending, fetchMessages, fetchConversations]);

    const handleSendDocument = useCallback(async (file, caption) => {
        if (!file || !selectedChat) return;
        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact_id);
            formData.append('filename', file.name);
            if (caption) formData.append('caption', caption);
            await api.sendPortalDocument(formData);
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send document:', err);
            alert('فشل إرسال الملف: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingDoc(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    const handleSendImage = useCallback(async (file, caption) => {
        if (!file || !selectedChat) return;
        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact_id);
            if (caption) formData.append('caption', caption);
            await api.sendPortalImage(formData);
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send image:', err);
            alert('فشل إرسال الصورة: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingDoc(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    const handleSendInteractive = useCallback(async (data) => {
        if (!selectedChat) return;
        try {
            setSendingInteractive(true);
            await api.sendPortalInteractiveMessage({
                recipient: selectedChat.contact_id,
                ...data,
            });
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send interactive:', err);
            alert('فشل إرسال الرسالة التفاعلية: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingInteractive(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    // ============================================
    // Messenger Send Handler (Portal unified)
    // ============================================

    const handleSendMessengerMessage = useCallback(async (text) => {
        if (!text?.trim() || !selectedChat) return;
        try {
            setSending(true);
            await api.sendPortalUnifiedMessage('messenger', selectedChat.contact_id, {
                message: text.trim(),
                linked_page_id: selectedChat.linked_page_id,
            });
            setNewMessage('');
            await fetchMessages(selectedChat);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            const errMsg = err.message || '';
            if (errMsg.includes('24') || errMsg.includes('window') || errMsg.includes('outside')) {
                setUtilityMessageText(text.trim());
                setUtilityError('');
                setUtilitySelectedTag('');
                try {
                    const tagsData = await api.getPortalMessageTags();
                    setUtilityTags(tagsData.tags || []);
                } catch {
                    setUtilityTags([]);
                }
                setUtilityDialogOpen(true);
            }
            console.error('Failed to send:', err);
        } finally {
            setSending(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    const handleSendUtilityMessage = async () => {
        if (!utilitySelectedTag || !utilityMessageText?.trim() || !selectedChat) return;
        try {
            setUtilitySending(true);
            setUtilityError('');
            await api.sendPortalUtilityMessage(
                selectedChat.linked_page_id,
                selectedChat.conversation_id,
                { message: utilityMessageText.trim(), tag: utilitySelectedTag }
            );
            setUtilityDialogOpen(false);
            setUtilityMessageText('');
            setUtilitySelectedTag('');
            await fetchMessages(selectedChat);
            fetchConversations();
            setSnackbar({ open: true, message: 'تم إرسال الرسالة الموسومة بنجاح', severity: 'success' });
        } catch (err) {
            setUtilityError(err.message || 'فشل إرسال الرسالة');
        } finally {
            setUtilitySending(false);
        }
    };

    // ============================================
    // SSE Integration (Portal endpoint)
    // ============================================

    useEffect(() => {
        const authToken = localStorage.getItem('auth_token');
        if (!authToken) return;

        const baseUrl = import.meta.env.VITE_API_URL || '';
        let evtSource = null;
        let reconnectTimeout = null;

        const connectSSE = async () => {
            try {
                const sseTokenRes = await fetch(`${baseUrl}/api/auth/sse-token`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (!sseTokenRes.ok) {
                    console.warn('[TenantInbox] Failed to get SSE token');
                    return;
                }

                const { token } = await sseTokenRes.json();
                evtSource = new EventSource(`${baseUrl}/api/portal/events?token=${token}`);

                evtSource.addEventListener('message:new', (e) => {
                    fetchConversations();
                    const current = selectedChatRef.current;
                    if (current && current.channel === 'whatsapp') {
                        const data = JSON.parse(e.data);
                        if (data.sender === current.contact_id || data.recipient === current.contact_id) {
                            fetchMessages(current);
                        }
                    }
                });

                evtSource.addEventListener('message:status', (e) => {
                    const data = JSON.parse(e.data);
                    setMessages(prev => prev.map(msg =>
                        msg.wamid === data.wamid ? { ...msg, status: data.status } : msg
                    ));
                });

                evtSource.addEventListener('fb_message:new', (e) => {
                    fetchConversations();
                    const current = selectedChatRef.current;
                    if (current && current.channel === 'messenger') {
                        const data = JSON.parse(e.data);
                        if (data.conversation_id === current.conversation_id) {
                            fetchMessages(current);
                        }
                    }
                });

                evtSource.addEventListener('conversation:update', () => {
                    fetchConversations();
                });

                evtSource.onerror = () => {
                    if (evtSource) evtSource.close();
                    reconnectTimeout = setTimeout(connectSSE, 5000);
                };
            } catch {
                reconnectTimeout = setTimeout(connectSSE, 5000);
            }
        };

        connectSSE();

        return () => {
            if (evtSource) evtSource.close();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [fetchConversations, fetchMessages]);

    // ============================================
    // Helper functions for ChatWindow
    // ============================================

    const getDisplayName = useCallback((chat) => {
        if (chat?.direction === 'outgoing') return 'أنت';
        return chat?.profile_name || chat?.sender_name || chat?.display_name || selectedChat?.display_name || chat?.sender || chat?.contact || 'مجهول';
    }, [selectedChat]);

    const formatTime = useCallback((dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    }, []);

    const getDateKey = useCallback((dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('ar-SA');
    }, []);

    const getStatusIcon = useCallback((status, direction) => {
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
    }, []);

    const getMediaDownloadUrl = useCallback((mediaId) => {
        return api.getPortalMediaDownloadUrl(mediaId);
    }, []);

    // Sync tenant's Messenger pages
    const handleSyncMessenger = useCallback(async () => {
        try {
            setSyncing(true);
            await api.syncPortalMessenger();
            await fetchConversations();
        } catch (err) {
            console.error('Messenger sync failed:', err);
        } finally {
            setSyncing(false);
        }
    }, [fetchConversations]);

    // ============================================
    // Render
    // ============================================

    const chatWindowChat = selectedChat?.channel === 'whatsapp' ? {
        contact: selectedChat.contact_id,
        profile_name: selectedChat.display_name,
        profile_picture_url: selectedChat.avatar_url || null,
    } : null;

    return (
        <Box sx={{ display: 'flex', height: { xs: 'calc(100vh - 56px)', md: '100vh' }, overflow: 'hidden' }}>
            {/* Sidebar */}
            <Box sx={{
                width: isMobile ? (selectedChat ? 0 : '100%') : 350,
                minWidth: isMobile ? 0 : 350,
                overflow: 'hidden',
                transition: 'width 0.3s',
                borderRight: 1,
                borderColor: 'divider',
            }}>
                <UnifiedSidebar
                    conversations={conversations}
                    selectedChat={selectedChat}
                    onSelectChat={handleSelectChat}
                    loading={loading}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    channelFilter={channelFilter}
                    setChannelFilter={setChannelFilter}
                    onRefresh={fetchConversations}
                    onSyncMessenger={handleSyncMessenger}
                    syncing={syncing}
                />
            </Box>

            {/* Chat Window */}
            <Box sx={{
                flex: 1,
                display: isMobile && !selectedChat ? 'none' : 'flex',
                overflow: 'hidden',
            }}>
                {selectedChat?.channel === 'whatsapp' ? (
                    <ChatWindow
                        selectedChat={chatWindowChat}
                        messages={messages}
                        loadingMessages={loadingMessages}
                        onSendMessage={handleSendWAMessage}
                        onSendTemplate={handleSendTemplate}
                        onSendDocument={handleSendDocument}
                        onSendImage={handleSendImage}
                        onSendInteractive={handleSendInteractive}
                        onBack={() => setSelectedChat(null)}
                        newMessage={newMessage}
                        setNewMessage={setNewMessage}
                        sending={sending}
                        sendingDoc={sendingDoc}
                        sendingInteractive={sendingInteractive}
                        messagesEndRef={messagesEndRef}
                        messagesContainerRef={messagesContainerRef}
                        getDisplayName={getDisplayName}
                        formatTime={formatTime}
                        getStatusIcon={getStatusIcon}
                        getMediaDownloadUrl={getMediaDownloadUrl}
                        getDateKey={getDateKey}
                        templates={templates}
                        windowStatus={windowStatus}
                    />
                ) : (
                    <UnifiedChatWindow
                        selectedChat={selectedChat}
                        messages={messages}
                        loadingMessages={loadingMessages}
                        onBack={() => setSelectedChat(null)}
                        onSendMessage={handleSendMessengerMessage}
                        newMessage={newMessage}
                        setNewMessage={setNewMessage}
                        sending={sending}
                        messagesEndRef={messagesEndRef}
                        messagesContainerRef={messagesContainerRef}
                        getDisplayName={getDisplayName}
                        formatTime={formatTime}
                    />
                )}
            </Box>

            <Dialog open={utilityDialogOpen} onClose={() => setUtilityDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>إرسال رسالة موسومة</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        نافذة المحادثة (24 ساعة) مغلقة. يمكنك إرسال رسالة موسومة خارج النافذة.
                    </Alert>
                    {utilityError && <Alert severity="error" sx={{ mb: 2 }}>{utilityError}</Alert>}
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>نوع الرسالة</InputLabel>
                        <Select value={utilitySelectedTag} onChange={e => setUtilitySelectedTag(e.target.value)} label="نوع الرسالة">
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
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        نص الرسالة:
                    </Typography>
                    <Typography variant="body1" sx={{ p: 1.5, bgcolor: 'grey.100', borderRadius: 1 }}>
                        {utilityMessageText}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUtilityDialogOpen(false)}>إلغاء</Button>
                    <Button
                        variant="contained"
                        onClick={handleSendUtilityMessage}
                        disabled={utilitySending || !utilitySelectedTag}
                        startIcon={utilitySending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                    >
                        {utilitySending ? 'جاري الإرسال...' : 'إرسال'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantInbox;
