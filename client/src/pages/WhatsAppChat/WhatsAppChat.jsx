import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import { Box, useTheme, useMediaQuery, Typography } from '@mui/material';
import {
    Check as CheckIcon,
    DoneAll as DoneAllIcon,
    AccessTime as AccessTimeIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import ChatSidebar from '../../components/WhatsApp/ChatSidebar';
import ChatWindow from '../../components/WhatsApp/ChatWindow';
import {
    getWhatsAppConversationKey,
    isSameWhatsAppConversation,
} from '../../utils/conversationKeys';
import { isNearBottom, scrollElementToBottom } from '../../utils/chatScroll';

const WhatsAppChat = () => {
    // State
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendingDoc, setSendingDoc] = useState(false);
    const [sendingInteractive, setSendingInteractive] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Refs
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const isFirstLoad = useRef(true);
    const selectedChatRef = useRef(null);
    const shouldStickToBottomRef = useRef(true);

    // Helpers
    const getDisplayName = (conv) => conv?.profile_name || conv?.contact || 'غير معروف';

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const oneDay = 24 * 60 * 60 * 1000;

        if (diff < oneDay && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
        } else if (diff < 2 * oneDay) {
            return 'أمس';
        } else {
            return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const getDateKey = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    };

    const getStatusIcon = (status, direction) => {
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

    // Effects
    const fetchConversations = async () => {
        try {
            const data = await api.getConversations();
            setConversations(data);
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch conversations:', error);
            setLoading(false);
        }
    };

    const fetchMessages = async (contact, tenantId = null) => {
        const requestedKey = getWhatsAppConversationKey({ contact, tenant_id: tenantId });
        try {
            if (isFirstLoad.current) setLoadingMessages(true);
            const data = await api.getThreadMessages(contact, 50, tenantId);
            if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
                shouldStickToBottomRef.current = isFirstLoad.current || isNearBottom(messagesContainerRef.current, 500);
                setMessages(data);
            }
            return data || [];

        } catch (error) {
            console.error('Failed to fetch messages:', error);
            if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
                setMessages([]);
            }
            return [];
        } finally {
            if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
                setLoadingMessages(false);
            }
        }
    };

    const markAsRead = async (messages, tenantId) => {
        try {
            const lastIncoming = messages.filter(m => m.direction === 'incoming').pop();
            if (lastIncoming?.wamid) {
                await api.markAsRead({
                    message_id: lastIncoming.wamid,
                    tenant_id: tenantId,
                });
            }
        } catch {
            // Best-effort, don't block UI
        }
    };

    const fetchTemplates = async (tenantId) => {
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
    };

    // SSE: Real-time updates with polling fallback
    useEffect(() => {
        fetchConversations();
        api.getMediaToken(); // Pre-fetch media token for image/doc URLs

        const authToken = localStorage.getItem('auth_token');
        const baseUrl = import.meta.env.VITE_API_URL || '';

        let pollingInterval = null;
        let evtSource = null;
        let reconnectTimeout = null;
        let sseConnected = false;

        // Start with polling as backup (slower interval)
        const startPolling = (interval = 60000) => {
            if (pollingInterval) clearInterval(pollingInterval);
            pollingInterval = setInterval(fetchConversations, interval);
        };

        const stopPolling = () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        };

        const connectSSE = async () => {
            try {
                // Get a one-time SSE token
                const sseTokenRes = await fetch(`${baseUrl}/api/auth/sse-token`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (!sseTokenRes.ok) {
                    console.warn('[SSE] Failed to get SSE token, using polling only');
                    startPolling(15000);
                    return;
                }

                const { token } = await sseTokenRes.json();
                evtSource = new EventSource(`${baseUrl}/api/messages/events?token=${token}`);

                evtSource.addEventListener('connected', () => {
                    sseConnected = true;
                    // Stop polling when SSE is active
                    stopPolling();
                });

                evtSource.addEventListener('message:new', (e) => {
                    const data = JSON.parse(e.data);
                    fetchConversations();
                    const current = selectedChatRef.current;
                    if (current && (data.sender === current.contact || data.recipient === current.contact)) {
                        fetchMessages(current.contact, current.tenant_id);
                    }
                });

                evtSource.addEventListener('message:status', (e) => {
                    const data = JSON.parse(e.data);
                    setMessages(prev => prev.map(msg =>
                        msg.wamid === data.wamid ? { ...msg, status: data.status } : msg
                    ));
                });

                evtSource.addEventListener('conversation:update', () => {
                    fetchConversations();
                });

                evtSource.onerror = () => {
                    if (sseConnected) {
                        console.warn('[SSE] Connection lost — falling back to polling');
                        sseConnected = false;
                        startPolling(10000);
                    }
                    // Reconnect after 5 seconds
                    reconnectTimeout = setTimeout(connectSSE, 5000);
                };
            } catch {
                console.warn('[SSE] Failed to connect, using polling only');
                startPolling(15000);
            }
        };

        // Initial connection
        if (authToken) {
            connectSSE();
        } else {
            startPolling(15000);
        }

        return () => {
            if (evtSource) evtSource.close();
            stopPolling();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, []);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat.contact, selectedChat.tenant_id).then((loadedMessages) => {
                if (!isSameWhatsAppConversation(selectedChatRef.current, selectedChat)) return;
                markAsRead(loadedMessages, selectedChat.tenant_id);
                setConversations(prev => prev.map(conv =>
                    isSameWhatsAppConversation(conv, selectedChat)
                        ? { ...conv, unread_count: 0 }
                        : conv
                ));
            });
            fetchTemplates(selectedChat.tenant_id);
            // Keep a slower poll for messages as backup
            const interval = setInterval(() => fetchMessages(selectedChat.contact, selectedChat.tenant_id), 15000);
            return () => clearInterval(interval);
        }
    }, [selectedChat]);

    // Smart Scroll
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        if (isFirstLoad.current) {
            scrollElementToBottom(container);
            isFirstLoad.current = false;
            return;
        }

        const lastMessage = messages[messages.length - 1];
        const isOutgoing = lastMessage?.direction === 'outgoing';

        if (isOutgoing || shouldStickToBottomRef.current) {
            scrollElementToBottom(container, 'smooth');
        }
    }, [messages]);

    const scrollToBottom = () => {
        setTimeout(() => {
            scrollElementToBottom(messagesContainerRef.current);
        }, 50);
    };

    // Handlers
    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedChat || sending) return;

        if (!selectedChat.tenant_id) {
            alert('لا يمكن الإرسال بدون عميل مرتبط بالمحادثة.');
            return;
        }

        try {
            setSending(true);
            const payload = {
                recipient: selectedChat.contact,
                type: 'text',
                message: newMessage,
                tenant_id: selectedChat.tenant_id,
            };
            await api.sendMessage(payload);
            setNewMessage('');
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            fetchConversations();
            scrollToBottom();
        } catch (error) {
            console.error('Failed to send:', error);
        } finally {
            setSending(false);
        }
    };

    const handleSendTemplate = async (templateData) => {
        if (!selectedChat || sending) return;
        if (!selectedChat.tenant_id) {
            alert('لا يمكن إرسال القوالب بدون عميل مرتبط بالمحادثة.');
            return;
        }

        try {
            setSending(true);
            await api.sendMessage({
                recipient: selectedChat.contact,
                type: 'template',
                templateName: templateData.name,
                templateLanguage: templateData.language,
                templateParams: templateData.components,
                tenant_id: selectedChat.tenant_id
            });
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            fetchConversations();
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
            formData.append('caption', caption || '');
            formData.append('type', 'document');

            if (selectedChat.tenant_id) {
                formData.append('tenant_id', selectedChat.tenant_id);
            } else {
                alert('لا يمكن إرسال الملفات بدون عميل مرتبط بالمحادثة.');
                return;
            }

            await api.sendMediaFile(formData);
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send document:', err);
            alert('فشل إرسال الملف');
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
            formData.append('caption', caption || '');
            formData.append('type', 'image');

            if (selectedChat.tenant_id) {
                formData.append('tenant_id', selectedChat.tenant_id);
            } else {
                alert('لا يمكن إرسال الصور بدون عميل مرتبط بالمحادثة.');
                return;
            }

            await api.sendMediaFile(formData);
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send image:', err);
            alert('فشل إرسال الصورة');
        } finally {
            setSendingDoc(false);
        }
    };

    const handleSendInteractive = async (data) => {
        if (!selectedChat) return;
        if (!selectedChat.tenant_id) {
            alert('لا يمكن إرسال الرسائل التفاعلية بدون عميل مرتبط بالمحادثة.');
            return;
        }

        try {
            setSendingInteractive(true);
            await api.sendInteractiveMessage({
                recipient: selectedChat.contact,
                tenant_id: selectedChat.tenant_id,
                ...data
            });
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            fetchConversations();
            scrollToBottom();
        } catch (err) {
            console.error('Failed to send interactive:', err);
            alert('فشل إرسال الرسالة التفاعلية');
        } finally {
            setSendingInteractive(false);
        }
    };

    // Filter Logic
    const filteredConversations = conversations.filter(conv => {
        const name = getDisplayName(conv).toLowerCase();
        const number = (conv.contact || '').toLowerCase();
        const search = searchTerm.toLowerCase();
        return name.includes(search) || number.includes(search);
    });

    // Responsive Logic
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const handleSelectChat = (chat) => {
        isFirstLoad.current = true;
        setMessages([]);
        setSelectedChat(chat);
        setNewMessage('');
        setSearchTerm('');
    };

    return (
        <Box sx={{ height: { xs: 'calc(100vh - 48px)', md: '100vh' }, display: 'flex', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Sidebar */}
            {(!isMobile || !selectedChat) && (
                <Box sx={{
                    width: { xs: '100%', md: '350px', lg: '400px' },
                    height: '100%',
                    flexShrink: 0,
                    minWidth: 0
                }}>
                    <ChatSidebar
                        conversations={filteredConversations}
                        selectedChat={selectedChat}
                        onSelectChat={handleSelectChat}
                        loading={loading}
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        getDisplayName={getDisplayName}
                        formatDate={formatDate}
                        contactsPath="/contacts"
                        broadcastPath="/broadcast"
                    />
                </Box>
            )}

            {/* Chat Window */}
            {(!isMobile || selectedChat) && (
                <Box sx={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
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
                            getMediaDownloadUrl={(mediaId, tenantId) => api.getMediaDownloadUrl(mediaId, tenantId)}
                            getDateKey={getDateKey}
                            templates={templates}
                        />
                    ) : (
                        // Empty State for Desktop
                        <Box sx={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'text.secondary',
                            bgcolor: '#f0f2f5',
                            borderBottom: '6px solid',
                            borderColor: 'success.main',
                            p: 3
                        }}>
                            <Typography variant="h5" fontWeight={300} gutterBottom>
                                اختر محادثة للبدء
                            </Typography>
                            <Typography variant="body2" sx={{ maxWidth: 450, textAlign: 'center', lineHeight: 1.6 }}>
                                حدد جهة اتصال من القائمة لعرض المحادثة
                            </Typography>
                        </Box>
                    )}
                </Box>
            )}
        </Box >
    );
};

export default WhatsAppChat;
