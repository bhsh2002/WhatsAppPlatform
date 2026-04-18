import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box,
    Paper,
    CircularProgress,
    useMediaQuery,
    useTheme
} from '@mui/material';
import api from '../../api';
import UnifiedSidebar from '../../components/Inbox/UnifiedSidebar';
import UnifiedChatWindow from '../../components/Inbox/UnifiedChatWindow';

const UnifiedInbox = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [channelFilter, setChannelFilter] = useState('');
    const [templates, setTemplates] = useState([]);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const selectedChatRef = useRef(null);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

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
    }, [fetchConversations]);

    const fetchMessages = useCallback(async (conv) => {
        try {
            setLoadingMessages(true);
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

    useEffect(() => {
        if (selectedChat) {
            fetchMessages(selectedChat).then(() => {
                markAsRead(messages, selectedChat);
            });
            if (selectedChat.channel === 'whatsapp') {
                fetchTemplates(selectedChat.tenant_id);
            } else {
                setTemplates([]);
            }
            const interval = setInterval(() => fetchMessages(selectedChat), 15000);
            return () => clearInterval(interval);
        }
    }, [selectedChat]);

    const handleSelectChat = useCallback((conv) => {
        setSelectedChat(conv);
        setNewMessage('');
        if (isMobile) {
            // On mobile, the chat window takes over
        }
    }, [isMobile]);

    // Auto-scroll to bottom when messages load/update
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = useCallback(async (text) => {
        if (!text?.trim() || !selectedChat) return;
        try {
            setSending(true);

            if (selectedChat.channel === 'whatsapp') {
                await api.sendUnifiedMessage('whatsapp', selectedChat.contact_id, {
                    message: text.trim(),
                    tenant_id: selectedChat.tenant_id,
                });
            } else if (selectedChat.channel === 'messenger') {
                await api.sendUnifiedMessage('messenger', selectedChat.contact_id, {
                    message: text.trim(),
                    linked_page_id: selectedChat.linked_page_id,
                });
            }

            setNewMessage('');
            await fetchMessages(selectedChat);
            fetchConversations();
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            setSending(false);
        }
    }, [selectedChat, fetchMessages, fetchConversations]);

    // SSE integration
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

    const getDisplayName = useCallback((msg) => {
        if (msg.direction === 'outgoing') return 'أنت';
        return msg.sender_name || selectedChat?.display_name || msg.sender || '';
    }, [selectedChat]);

    const formatTime = useCallback((dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    }, []);

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
                <UnifiedChatWindow
                    selectedChat={selectedChat}
                    messages={messages}
                    loadingMessages={loadingMessages}
                    onBack={() => setSelectedChat(null)}
                    onSendMessage={handleSendMessage}
                    newMessage={newMessage}
                    setNewMessage={setNewMessage}
                    sending={sending}
                    messagesEndRef={messagesEndRef}
                    messagesContainerRef={messagesContainerRef}
                    getDisplayName={getDisplayName}
                    formatTime={formatTime}
                    templates={templates}
                />
            </Box>
        </Box>
    );
};

export default UnifiedInbox;