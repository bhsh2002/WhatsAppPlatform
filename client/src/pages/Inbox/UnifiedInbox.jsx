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
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import UnifiedSidebar from '../../components/Inbox/UnifiedSidebar';
import UnifiedChatWindow from '../../components/Inbox/UnifiedChatWindow';
import ChatWindow from '../../components/WhatsApp/ChatWindow';
import {
    getUnifiedConversationKey,
    isSameUnifiedConversation,
} from '../../utils/conversationKeys';
import { isNearBottom, scrollElementToBottom } from '../../utils/chatScroll';

const UnifiedInbox = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [searchParams] = useSearchParams();
    const initialChannel = ['whatsapp', 'messenger'].includes(searchParams.get('channel'))
        ? searchParams.get('channel')
        : '';

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
    const [channelFilter, setChannelFilter] = useState(initialChannel);
    const [templates, setTemplates] = useState([]);
    const [windowStatus, setWindowStatus] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [utilityFallback, setUtilityFallback] = useState(null);
    const [botSession, setBotSession] = useState(null);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const selectedChatRef = useRef(null);
    const isFirstLoad = useRef(true);
    const shouldStickToBottomRef = useRef(true);

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

    useEffect(() => {
        const channel = searchParams.get('channel');
        if (['whatsapp', 'messenger'].includes(channel) && channelFilter !== channel) {
            setChannelFilter(channel);
        }
    }, [channelFilter, searchParams]);

    const fetchMessages = useCallback(async (conv) => {
        const requestedKey = getUnifiedConversationKey(conv);
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
            if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
                shouldStickToBottomRef.current = isFirstLoad.current || isNearBottom(messagesContainerRef.current);
                setMessages(data);
            }
            return data || [];
        } catch (error) {
            console.error('Failed to fetch messages:', error);
            if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
                setMessages([]);
            }
            return [];
        } finally {
            if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
                setLoadingMessages(false);
            }
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

    const fetchWindowStatus = useCallback(async (contactId, tenantId) => {
        if (!contactId) {
            setWindowStatus(null);
            return;
        }
        try {
            const data = await api.getAdminWindowStatus(contactId, tenantId);
            setWindowStatus(data);
        } catch {
            setWindowStatus(null);
        }
    }, []);

    const fetchBotSession = useCallback(async (conv) => {
        if (!conv || conv.channel !== 'messenger' || !conv.conversation_id || !conv.tenant_id) {
            setBotSession(null);
            return null;
        }
        try {
            const sessions = await api.getMessengerBotSessions(conv.tenant_id, { conversation_id: conv.conversation_id });
            const session = Array.isArray(sessions) ? sessions[0] || null : null;
            setBotSession(session);
            return session;
        } catch {
            setBotSession(null);
            return null;
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
            fetchMessages(selectedChat).then((loadedMessages) => {
                if (!isSameUnifiedConversation(selectedChatRef.current, selectedChat)) return;
                markAsRead(loadedMessages, selectedChat);
                setConversations(prev => prev.map(conv =>
                    isSameUnifiedConversation(conv, selectedChat) ? { ...conv, unread_count: 0 } : conv
                ));
            });
            if (selectedChat.channel === 'whatsapp') {
                fetchTemplates(selectedChat.tenant_id);
                fetchWindowStatus(selectedChat.contact_id, selectedChat.tenant_id);
                setBotSession(null);
            } else {
                setTemplates([]);
                setWindowStatus(null);
                fetchBotSession(selectedChat);
            }
            const interval = setInterval(() => fetchMessages(selectedChat), 15000);
            return () => clearInterval(interval);
        } else {
            setWindowStatus(null);
            setBotSession(null);
        }
    }, [selectedChat, fetchMessages, fetchTemplates, fetchWindowStatus, fetchBotSession, markAsRead]);

    const handleSelectChat = useCallback((conv) => {
        isFirstLoad.current = true;
        setMessages([]);
        setSelectedChat(conv);
        setNewMessage('');
        setUtilityFallback(null);
    }, []);

    useEffect(() => {
        const requestedChannel = searchParams.get('channel') || 'whatsapp';
        const requestedContact = searchParams.get('contact');
        if (requestedChannel !== 'whatsapp' || !requestedContact || loading) return;

        const normalizedContact = requestedContact.replace(/\+/g, '').trim();
        const requestedTenantId = searchParams.get('tenant_id');
        const found = conversations.find(conv =>
            conv.channel === 'whatsapp'
            && String(conv.contact_id) === normalizedContact
            && (!requestedTenantId || String(conv.tenant_id) === requestedTenantId)
        );
        const nextChat = found || {
            channel: 'whatsapp',
            contact_id: normalizedContact,
            display_name: searchParams.get('name') || normalizedContact,
            avatar_url: null,
            tenant_id: requestedTenantId ? Number(requestedTenantId) : null,
            tenant_name: null,
            last_ctwa_clid: null,
            last_ctwa_source_id: null,
            last_ctwa_source_type: null,
            last_ctwa_source_url: null,
            last_ctwa_received_at: null,
        };

        if (!isSameUnifiedConversation(selectedChatRef.current, nextChat)) {
            handleSelectChat(nextChat);
        }
    }, [conversations, handleSelectChat, loading, searchParams]);

    // Smart scroll (matching TenantChat behavior)
    useEffect(() => {
        if (messages.length === 0) return;

        const container = messagesContainerRef.current;
        if (!container) return;

        if (isFirstLoad.current) {
            scrollElementToBottom(container);
            isFirstLoad.current = false;
            return;
        }

        if (shouldStickToBottomRef.current) {
            scrollElementToBottom(container, 'smooth');
        }
    }, [messages]);

    const scrollToBottom = () => {
        setTimeout(() => {
            scrollElementToBottom(messagesContainerRef.current);
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
                templateLanguage: templateData.language?.code || templateData.language || 'ar',
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
            const errMsg = err.message || '';
            if (errMsg.includes('24') || errMsg.includes('window') || errMsg.includes('outside')) {
                setUtilityFallback({ text: text.trim(), timestamp: Date.now() });
            }
            console.error('Failed to send:', err);
        } finally {
            setSending(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    const handleGetMessageTags = useCallback(async () => {
        return await api.getAdminMessageTags();
    }, []);

    const handleSendUtilityMessage = useCallback(async (message, tag) => {
        if (!selectedChat?.linked_page_id || !selectedChat?.conversation_id) {
            throw new Error('بيانات المحادثة غير مكتملة');
        }
        await api.sendAdminUtilityMessage(
            selectedChat.linked_page_id,
            selectedChat.conversation_id,
            { message, tag }
        );
        await fetchMessages(selectedChat);
        fetchConversations();
    }, [selectedChat, fetchMessages, fetchConversations]);

    const handleBotStatusChange = useCallback(async (status) => {
        if (!botSession?.id || !selectedChat?.tenant_id) {
            alert('لا توجد جلسة بوت لهذه المحادثة بعد. ستظهر بعد أول رسالة يتعامل معها البوت.');
            return;
        }
        await api.updateMessengerBotSession(selectedChat.tenant_id, botSession.id, status);
        await fetchBotSession(selectedChat);
    }, [botSession, fetchBotSession, selectedChat]);

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

    // Sync all Messenger pages (same as /messenger sync button)
    const handleSyncMessenger = useCallback(async () => {
        try {
            setSyncing(true);
            const pages = await api.getFbAllPages();
            if (Array.isArray(pages) && pages.length > 0) {
                for (const page of pages) {
                    await api.syncMessengerConversations(page.id);
                }
            }
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

    // Map unified chat shape to ChatWindow's expected shape
    const chatWindowChat = selectedChat?.channel === 'whatsapp' ? {
        contact: selectedChat.contact_id,
        profile_name: selectedChat.display_name,
        profile_picture_url: selectedChat.avatar_url || null,
        tenant_id: selectedChat.tenant_id,
        last_ctwa_clid: selectedChat.last_ctwa_clid || null,
        last_ctwa_source_id: selectedChat.last_ctwa_source_id || null,
        last_ctwa_source_type: selectedChat.last_ctwa_source_type || null,
        last_ctwa_source_url: selectedChat.last_ctwa_source_url || null,
        last_ctwa_received_at: selectedChat.last_ctwa_received_at || null,
    } : null;

    return (
        <Box sx={{ display: 'flex', height: { xs: 'calc(100vh - 56px)', md: '100vh' }, overflow: 'hidden' }}>
            {/* Sidebar */}
            <Box sx={{
                width: isMobile ? (selectedChat ? 0 : '100%') : 350,
                minWidth: isMobile ? 0 : 350,
                display: isMobile && selectedChat ? 'none' : 'flex',
                flexDirection: 'column',
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
                minWidth: 0,
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
                        onSendUtilityMessage={handleSendUtilityMessage}
                        getMessageTags={handleGetMessageTags}
                        utilityFallback={utilityFallback}
                        botSession={botSession}
                        onBotStatusChange={handleBotStatusChange}
                    />
                )}
            </Box>
        </Box>
    );
};

export default UnifiedInbox;
