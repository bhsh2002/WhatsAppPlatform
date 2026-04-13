import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import { Box, useTheme, useMediaQuery, Typography, IconButton, Tooltip } from '@mui/material';
import {
    Check as CheckIcon,
    DoneAll as DoneAllIcon,
    AccessTime as AccessTimeIcon,
    Error as ErrorIcon,
    Campaign as CampaignIcon
} from '@mui/icons-material';
import ChatSidebar from '../../components/WhatsApp/ChatSidebar';
import ChatWindow from '../../components/WhatsApp/ChatWindow';
import BroadcastDialog from '../../components/WhatsApp/BroadcastDialog';

const WhatsAppChat = () => {
    // State
    const [conversations, setConversations] = useState([]);
    const [contacts, setContacts] = useState([]);
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
    const [showBroadcast, setShowBroadcast] = useState(false);
    const [broadcasting, setBroadcasting] = useState(false);

    // Refs
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const isFirstLoad = useRef(true);

    // Helpers
    const getCredentials = () => ({
        token: localStorage.getItem('ab_wa_token') || '',
        phoneId: localStorage.getItem('ab_wa_phoneId') || '',
    });

    const getDisplayName = (conv) => conv.profile_name || conv.contact;

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
        try {
            if (isFirstLoad.current) setLoadingMessages(true);
            const data = await api.getThreadMessages(contact, 50, tenantId);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setLoadingMessages(false);
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

    // Contacts handlers
    const fetchContacts = async () => {
        try {
            const data = await api.getContacts();
            setContacts(data.contacts || data || []);
        } catch (err) {
            console.error('Failed to fetch contacts:', err);
        }
    };

    const handleAddContact = async (contactData) => {
        await api.createContact(contactData);
        await fetchContacts();
    };

    const handleEditContact = async (contactId, contactData) => {
        await api.updateContact(contactId, contactData);
        await fetchContacts();
    };

    const handleDeleteContact = async (contactId) => {
        await api.deleteContact(contactId);
        await fetchContacts();
    };

    const handleBroadcast = async (data) => {
        setBroadcasting(true);
        try {
            await api.broadcastMessage(data);
            await fetchConversations();
        } finally {
            setBroadcasting(false);
        }
    };

    // SSE: Real-time updates with polling fallback
    useEffect(() => {
        fetchConversations();

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
                    console.log('[SSE] Connected — real-time updates active');
                    // Stop polling when SSE is active
                    stopPolling();
                });

                evtSource.addEventListener('message:new', (e) => {
                    const data = JSON.parse(e.data);
                    fetchConversations();
                    if (selectedChat && (data.sender === selectedChat.contact || data.recipient === selectedChat.contact)) {
                        fetchMessages(selectedChat.contact, selectedChat.tenant_id);
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
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat.contact, selectedChat.tenant_id);
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
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            isFirstLoad.current = false;
            return;
        }

        const lastMessage = messages[messages.length - 1];
        const isOutgoing = lastMessage?.direction === 'outgoing';
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

        if (isOutgoing || distanceFromBottom < 500) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 50);
    };

    // Handlers
    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedChat || sending) return;

        const credentials = getCredentials();
        if (!selectedChat.tenant_id && (!credentials.token || !credentials.phoneId)) {
            return;
        }

        try {
            setSending(true);
            const payload = {
                recipient: selectedChat.contact,
                type: 'text',
                message: newMessage,
                tenant_id: selectedChat.tenant_id || null,
                phone_number_id: selectedChat.tenant_id ? null : credentials.phoneId,
                access_token: selectedChat.tenant_id ? null : credentials.token,
            };
            await api.sendMessage(payload);
            setNewMessage('');
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            scrollToBottom();
        } catch (error) {
            console.error('Failed to send:', error);
        } finally {
            setSending(false);
        }
    };

    const handleSendTemplate = async (templateData) => {
        if (!selectedChat || sending) return;

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

        const credentials = getCredentials();
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
                formData.append('phone_number_id', credentials.phoneId);
                formData.append('access_token', credentials.token);
            }

            await api.sendMediaFile(formData);
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
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

        const credentials = getCredentials();
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
                formData.append('phone_number_id', credentials.phoneId);
                formData.append('access_token', credentials.token);
            }

            await api.sendMediaFile(formData);
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
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

        const credentials = getCredentials();
        try {
            setSendingInteractive(true);
            await api.sendInteractiveMessage({
                recipient: selectedChat.contact,
                tenant_id: selectedChat.tenant_id || null,
                phone_number_id: selectedChat.tenant_id ? null : credentials.phoneId,
                access_token: selectedChat.tenant_id ? null : credentials.token,
                ...data
            });
            await fetchMessages(selectedChat.contact, selectedChat.tenant_id);
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
        const number = conv.contact.toLowerCase();
        const search = searchTerm.toLowerCase();
        return name.includes(search) || number.includes(search);
    });

    // Responsive Logic
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        setSearchTerm('');
    };

    return (
        <Box sx={{ height: '100vh', display: 'flex', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Sidebar */}
            {(!isMobile || !selectedChat) && (
                <Box sx={{
                    width: { xs: '100%', md: '350px', lg: '400px' },
                    height: '100%',
                    flexShrink: 0
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
                        contacts={contacts}
                        onLoadContacts={fetchContacts}
                        onAddContact={handleAddContact}
                        onEditContact={handleEditContact}
                        onDeleteContact={handleDeleteContact}
                        headerAction={
                            <Tooltip title="إرسال جماعي">
                                <IconButton
                                    onClick={() => setShowBroadcast(true)}
                                    size="small"
                                    sx={{
                                        bgcolor: 'secondary.main',
                                        color: 'white',
                                        '&:hover': { bgcolor: 'secondary.dark' },
                                        width: 36,
                                        height: 36
                                    }}
                                >
                                    <CampaignIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        }
                    />
                </Box>
            )}

            {/* Chat Window */}
            {(!isMobile || selectedChat) && (
                <Box sx={{ flex: 1, height: '100%', position: 'relative' }}>
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
                            <Box sx={{ mb: 4 }}>
                                <img
                                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/512px-WhatsApp.svg.png"
                                    alt="WhatsApp"
                                    style={{ width: 80, height: 80, opacity: 0.6, filter: 'grayscale(100%)' }}
                                />
                            </Box>
                            <Typography variant="h5" fontWeight={300} gutterBottom>
                                WhatsApp for Business
                            </Typography>
                            <Typography variant="body2" sx={{ maxWidth: 450, textAlign: 'center', lineHeight: 1.6 }}>
                                أرسل واستقبل الرسائل دون إبقاء هاتفك متصلاً.
                                <br />
                                استخدم WhatsApp على ما يصل إلى 4 أجهزة مرتبطة وهاتف واحد في نفس الوقت.
                            </Typography>
                        </Box>
                    )}
                </Box>
)}
            </Box>

            {/* Broadcast Dialog */}
            <BroadcastDialog
                open={showBroadcast}
                onClose={() => setShowBroadcast(false)}
                onSend={handleBroadcast}
                contacts={contacts}
                templates={templates.filter(t => t.status === 'APPROVED')}
                loading={broadcasting}
            />
        </Box>
    );
};

export default WhatsAppChat;
