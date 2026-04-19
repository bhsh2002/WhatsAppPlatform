import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import {
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import api from '../../api';
import UnifiedSidebar from '../../components/Inbox/UnifiedSidebar';
import UnifiedChatWindow from '../../components/Inbox/UnifiedChatWindow';
import ChatWindow from '../../components/WhatsApp/ChatWindow';

const UnifiedInbox = () => {
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

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const selectedChatRef = useRef(null);
    const isFirstLoad = useRef(true);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    // ============================================
    // Data Fetching
    // ============================================

    const fetchConversations = useCallback(async () => {
        try {
            setLoading(true);
            const params = {};
            if (channelFilter) params.channel = channelFilter;
            const data = await api.getUnifiedConversations(params);
            setConversations(data);
        } catch (error) {
            console.error('Failed to fetch conversations:', error);
        } finally {
            setLoading(false);
        }
    }, [channelFilter]);

    useEffect(() => {
        fetchConversations();
        api.getMediaToken(); // Pre-fetch media token for image/doc URLs
    }, [fetchConversations]);

    const fetchMessages = useCallback(async (conv) => {
        try {
            if (isFirstLoad.current) setLoadingMessages(true);
            const params = {};
            if (conv.channel === 'whatsapp') {
                params.tenant_id = conv.tenant_id;
            } else if (conv.channel === 'messenger') {
                params.conversation_id = conv.conversation_id;
                params.linked_page_id = conv.linked_page_id;
            }
            const data = await api.getUnifiedMessages(conv.channel, conv.contact_id, params);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
            setMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    }, []);

    const fetchTemplates = useCallback(async (tenantId) => {
        if (!tenantId) {
            setTemplates([]);
            return;
        }
        try {
            const data = await api.getTenantTemplates(tenantId);
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
                    await api.markAsRead({
                        message_id: lastIncoming.wamid,
                        tenant_id: conv.tenant_id,
                    });
                }
            } else if (conv.channel === 'messenger') {
                await api.markUnifiedRead('messenger', conv.contact_id, {
                    conversation_id: conv.conversation_id,
                    linked_page_id: conv.linked_page_id,
                });
            }
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
                fetchTemplates(selectedChat.tenant_id);
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

    // Smart scroll (matching TenantChat behavior)
    useEffect(() => {
        if (messages.length === 0) return;

        if (isFirstLoad.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            isFirstLoad.current = false;
            return;
        }

        const container = messagesContainerRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom < 300) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 50);
    };

    // ============================================
    // WhatsApp Send Handlers (matching admin API)
    // ============================================

    // ChatWindow calls onSendMessage() with NO arguments — it manages newMessage state internally
    const handleSendWAMessage = useCallback(async () => {
        if (!newMessage.trim() || !selectedChat || sending) return;
        try {
            setSending(true);
            await api.sendMessage({
                recipient: selectedChat.contact_id,
                type: 'text',
                message: newMessage.trim(),
                tenant_id: selectedChat.tenant_id,
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

    // ChatWindow TemplatePicker calls onSelect(templateData) where templateData = { name, language, components }
    const handleSendTemplate = useCallback(async (templateData) => {
        if (!selectedChat || sending) return;
        try {
            setSending(true);
            await api.sendMessage({
                recipient: selectedChat.contact_id,
                type: 'template',
                templateName: templateData.name,
                templateLanguage: templateData.language,
                templateParams: templateData.components,
                tenant_id: selectedChat.tenant_id,
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

    // ChatWindow calls onSendDocument(file, caption)
    const handleSendDocument = useCallback(async (file, caption) => {
        if (!file || !selectedChat) return;
        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact_id);
            formData.append('caption', caption || '');
            formData.append('type', 'document');
            if (selectedChat.tenant_id) {
                formData.append('tenant_id', selectedChat.tenant_id);
            }
            await api.sendMediaFile(formData);
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

    // ChatWindow calls onSendImage(file, caption)
    const handleSendImage = useCallback(async (file, caption) => {
        if (!file || !selectedChat) return;
        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact_id);
            formData.append('caption', caption || '');
            formData.append('type', 'image');
            if (selectedChat.tenant_id) {
                formData.append('tenant_id', selectedChat.tenant_id);
            }
            await api.sendMediaFile(formData);
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

    // ChatWindow calls onSendInteractive(data)
    const handleSendInteractive = useCallback(async (data) => {
        if (!selectedChat) return;
        try {
            setSendingInteractive(true);
            await api.sendInteractiveMessage({
                recipient: selectedChat.contact_id,
                tenant_id: selectedChat.tenant_id,
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
    // Messenger Send Handler
    // ============================================

    const handleSendMessengerMessage = useCallback(async (text) => {
        if (!text?.trim() || !selectedChat) return;
        try {
            setSending(true);
            await api.sendUnifiedMessage('messenger', selectedChat.contact_id, {
                message: text.trim(),
                linked_page_id: selectedChat.linked_page_id,
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
    }, [selectedChat, fetchMessages, fetchConversations]);

    // ============================================
    // SSE Integration
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
                    console.warn('[UnifiedInbox] Failed to get SSE token');
                    return;
                }

                const { token } = await sseTokenRes.json();
                evtSource = new EventSource(`${baseUrl}/api/messages/events?token=${token}`);

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

                evtSource.addEventListener('broadcast:progress', () => { });
                evtSource.addEventListener('broadcast:complete', () => { });

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
        // ChatWindow passes the selectedChat object for header, or a message for bubbles
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

    const getMediaDownloadUrl = useCallback((mediaId, tenantId) => {
        return api.getMediaDownloadUrl(mediaId, tenantId || selectedChat?.tenant_id);
    }, [selectedChat]);

    // ============================================
    // Render
    // ============================================

    // Map unified chat shape to ChatWindow's expected shape
    const chatWindowChat = selectedChat?.channel === 'whatsapp' ? {
        contact: selectedChat.contact_id,
        profile_name: selectedChat.display_name,
        tenant_id: selectedChat.tenant_id,
    } : null;

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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
        </Box>
    );
};

export default UnifiedInbox;