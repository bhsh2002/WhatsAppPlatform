import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import { Box, useTheme, useMediaQuery, Typography } from '@mui/material';
import {
    Phone as PhoneIcon,
    Check as CheckIcon,
    DoneAll as DoneAllIcon,
    AccessTime as AccessTimeIcon,
    Error as ErrorIcon
} from '@mui/icons-material';
import ChatSidebar from '../../components/WhatsApp/ChatSidebar';
import ChatWindow from '../../components/WhatsApp/ChatWindow';

// api instance imported directly

const WhatsAppChat = () => {
    // State
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState(null);

    // File State
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [showAttachMenu, setShowAttachMenu] = useState(false); // Managed by ChatWindow mainly, but kept here if needed

    // Refs
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const isFirstLoad = useRef(true);
    const fileInputRef = useRef(null);

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
            const data = await api.getThreadMessages(contact, 50, tenantId);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        }
    };

    useEffect(() => {
        fetchConversations();
        const interval = setInterval(fetchConversations, 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            const interval = setInterval(() => fetchMessages(selectedChat.contact, selectedChat.tenant_id), 5000);
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

    // Handlers
    const handleSendMessage = async () => {
        if ((!newMessage.trim() && !selectedFile) || !selectedChat) return;

        const credentials = getCredentials();
        if (!selectedChat.tenant_id && (!credentials.token || !credentials.phoneId)) {
            setSendError('Missing credentials');
            return;
        }

        setSending(true);
        setSendError(null);

        try {
            if (selectedFile) {
                const formData = new FormData();
                formData.append('file', selectedFile);
                formData.append('recipient', selectedChat.contact);
                formData.append('caption', newMessage);

                if (selectedChat.tenant_id) {
                    formData.append('tenant_id', selectedChat.tenant_id);
                } else {
                    formData.append('phone_number_id', credentials.phoneId);
                    formData.append('access_token', credentials.token);
                }

                if (selectedFile.type.startsWith('image/')) formData.append('type', 'image');
                else if (selectedFile.type.startsWith('video/')) formData.append('type', 'video');
                else if (selectedFile.type.startsWith('audio/')) formData.append('type', 'audio');
                else formData.append('type', 'document');

                await api.sendMediaFile(formData);
            } else {
                const payload = {
                    recipient: selectedChat.contact,
                    type: 'text',
                    message: newMessage,
                    tenant_id: selectedChat.tenant_id || null,
                    phone_number_id: selectedChat.tenant_id ? null : credentials.phoneId,
                    access_token: selectedChat.tenant_id ? null : credentials.token,
                };
                await api.sendMessage(payload);
            }

            setNewMessage('');
            clearSelectedFile();
            fetchMessages(selectedChat.contact, selectedChat.tenant_id);
        } catch (error) {
            console.error('Failed to send:', error);
            setSendError('Failed to send message');
        } finally {
            setSending(false);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setShowAttachMenu(false);
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onloadend = () => setFilePreview(reader.result);
                reader.readAsDataURL(file);
            } else {
                setFilePreview(null);
            }
        }
    };

    const clearSelectedFile = () => {
        setSelectedFile(null);
        setFilePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
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
        setSearchTerm(''); // Optional: clear search on select
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
                            loadingMessages={false}
                            onSendMessage={handleSendMessage}
                            onBack={() => setSelectedChat(null)}
                            newMessage={newMessage}
                            setNewMessage={setNewMessage}
                            messagesEndRef={messagesEndRef}
                            messagesContainerRef={messagesContainerRef}
                            getDisplayName={getDisplayName}
                            formatTime={formatTime}
                            getStatusIcon={getStatusIcon}
                            getMediaDownloadUrl={(mediaId, tenantId) => api.getMediaDownloadUrl(mediaId, tenantId)}
                            selectedFile={selectedFile}
                            setSelectedFile={setSelectedFile}
                            filePreview={filePreview}
                            clearSelectedFile={clearSelectedFile}
                            handleFileSelect={handleFileSelect}
                            getDateKey={getDateKey}
                            fileInputRef={fileInputRef}
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
                            bgcolor: '#f0f2f5', // WhatsApp web background
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
    );
};

export default WhatsAppChat;
