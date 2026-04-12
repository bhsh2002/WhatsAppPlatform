import React, { useState, useEffect, useRef } from 'react';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import {
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import api from '../../api';
import ChatSidebar from '../../components/WhatsApp/ChatSidebar';
import ChatWindow from '../../components/WhatsApp/ChatWindow';

const TenantChat = () => {
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendingDoc, setSendingDoc] = useState(false);
    const [sendingInteractive, setSendingInteractive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Template State
    const [templates, setTemplates] = useState([]);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const isFirstLoad = useRef(true);

    // Responsive
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // SSE: Real-time updates with polling fallback
    useEffect(() => {
        fetchConversations();
        fetchTemplates();

        const baseUrl = import.meta.env.VITE_API_URL || '';
        let pollingInterval = setInterval(fetchConversations, 15000);
        let sseConnected = false;

        try {
            const evtSource = new EventSource(`${baseUrl}/api/portal/events`);

            evtSource.addEventListener('connected', () => {
                sseConnected = true;
                clearInterval(pollingInterval);
                pollingInterval = setInterval(fetchConversations, 30000);
            });

            evtSource.addEventListener('message:new', (e) => {
                const data = JSON.parse(e.data);
                fetchConversations();
                if (selectedChat && (data.sender === selectedChat.contact || data.recipient === selectedChat.contact)) {
                    fetchMessages(selectedChat.contact);
                }
            });

            evtSource.addEventListener('message:status', (e) => {
                const data = JSON.parse(e.data);
                setMessages(prev => prev.map(msg =>
                    msg.wamid === data.wamid ? { ...msg, status: data.status } : msg
                ));
            });

            evtSource.addEventListener('conversation:update', () => fetchConversations());

            evtSource.onerror = () => {
                if (sseConnected) {
                    sseConnected = false;
                    clearInterval(pollingInterval);
                    pollingInterval = setInterval(fetchConversations, 10000);
                }
            };

            return () => { evtSource.close(); clearInterval(pollingInterval); };
        } catch {
            return () => clearInterval(pollingInterval);
        }
    }, []);

    useEffect(() => {
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat.contact);
            const interval = setInterval(() => fetchMessages(selectedChat.contact), 15000);
            return () => clearInterval(interval);
        }
    }, [selectedChat]);

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
            if (isFirstLoad.current) setLoadingMessages(true);
            const data = await api.getPortalMessages(phone);
            setMessages(data);
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            setLoadingMessages(false);
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 50);
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedChat || sending) return;

        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedChat.contact,
                type: 'text',
                message: newMessage.trim()
            });
            setNewMessage('');
            await fetchMessages(selectedChat.contact);
            scrollToBottom();
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
                components: templateData.components
            });
            await fetchMessages(selectedChat.contact);
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send template:', err);
            alert('فشل إرسال القالب');
        } finally {
            setSending(false);
        }
    };

    const handleSendDocument = async (file, caption) => {
        if (!file || !selectedChat) return;

        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact);
            formData.append('filename', file.name);
            if (caption) {
                formData.append('caption', caption);
            }

            await api.sendPortalDocument(formData);
            await fetchMessages(selectedChat.contact);
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send document:', err);
            alert('فشل إرسال الملف: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingDoc(false);
        }
    };

    const handleSendImage = async (file, caption) => {
        if (!file || !selectedChat) return;

        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', file);
            formData.append('recipient', selectedChat.contact);
            if (caption) {
                formData.append('caption', caption);
            }

            await api.sendPortalImage(formData);
            await fetchMessages(selectedChat.contact);
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send image:', err);
            alert('فشل إرسال الصورة: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingDoc(false);
        }
    };

    const handleSendInteractive = async (data) => {
        if (!selectedChat) return;

        try {
            setSendingInteractive(true);
            await api.sendPortalInteractiveMessage({
                recipient: selectedChat.contact,
                ...data
            });
            await fetchMessages(selectedChat.contact);
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send interactive:', err);
            alert('فشل إرسال الرسالة التفاعلية: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingInteractive(false);
        }
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

    const getMediaDownloadUrl = (mediaId) => {
        return api.getPortalMediaDownloadUrl(mediaId);
    };

    const filteredConversations = conversations.filter(conv =>
        (conv.profile_name || conv.contact || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
    };

    return (
        <Box sx={{ height: '100vh', display: 'flex', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Sidebar */}
            {(!isMobile || !selectedChat) && (
                <Box sx={{
                    width: { xs: '100%', md: 350 },
                    height: '100%',
                    flexShrink: 0
                }}>
                    <ChatSidebar
                        conversations={filteredConversations}
                        selectedChat={selectedChat}
                        onSelectChat={handleSelectChat}
                        loading={loading}
                        searchTerm={searchQuery}
                        setSearchTerm={setSearchQuery}
                        getDisplayName={getDisplayName}
                        formatDate={formatDate}
                    />
                </Box>
            )}

            {/* Chat Window */}
            {(!isMobile || selectedChat) && (
                <Box sx={{ flex: 1, height: '100%' }}>
                    {selectedChat ? (
                        <ChatWindow
                            selectedChat={selectedChat}
                            messages={messages}
                            loadingMessages={loadingMessages}
                            onSendMessage={handleSendMessage}
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
                        />
                    ) : (
                        <Box sx={{
                            flex: 1,
                            height: '100%',
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
                    )}
                </Box>
            )}
        </Box>
    );
};

export default TenantChat;
