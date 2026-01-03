import React, { useState, useEffect, useRef } from 'react';
import { Search, Send, MoreVertical, Phone, Paperclip, Smile, Image as ImageIcon, Mic, Check, CheckCheck, X, File, Download, Play } from 'lucide-react';
import api from '../../api';
import { useTenants } from '../../context/TenantContext';

const WhatsAppChat = () => {
    const { tenants } = useTenants();
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [sendError, setSendError] = useState(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    // Get stored credentials from localStorage
    const getCredentials = () => ({
        token: localStorage.getItem('ab_wa_token') || '',
        phoneId: localStorage.getItem('ab_wa_phoneId') || '',
    });

    // Fetch conversations on load
    useEffect(() => {
        fetchConversations();
        const interval = setInterval(fetchConversations, 10000);
        return () => clearInterval(interval);
    }, []);

    // Fetch messages when chat is selected
    useEffect(() => {
        if (selectedChat) {
            fetchMessages(selectedChat.contact, selectedChat.tenant_id);
            const interval = setInterval(() => fetchMessages(selectedChat.contact, selectedChat.tenant_id), 5000);
            return () => clearInterval(interval);
        }
    }, [selectedChat]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if ((!newMessage.trim() && !selectedFile) || !selectedChat) return;

        const credentials = getCredentials();

        // Check if credentials exist (only if no tenant selected)
        if (!selectedChat.tenant_id && (!credentials.token || !credentials.phoneId)) {
            setSendError('لم يتم تكوين بيانات الربط. يرجى الذهاب إلى صفحة الإعدادات وإدخال Phone Number ID و Access Token.');
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

                if (selectedFile.type.startsWith('image/')) {
                    formData.append('type', 'image');
                } else if (selectedFile.type.startsWith('video/')) {
                    formData.append('type', 'video');
                } else if (selectedFile.type.startsWith('audio/')) {
                    formData.append('type', 'audio');
                } else {
                    formData.append('type', 'document');
                }

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
            setSelectedFile(null);
            setFilePreview(null);
            fetchMessages(selectedChat.contact, selectedChat.tenant_id);
        } catch (error) {
            console.error('Failed to send message:', error);
            setSendError(error.message || 'فشل في إرسال الرسالة');
        } finally {
            setSending(false);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setShowAttachMenu(false);

            // Create preview for images
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    setFilePreview(reader.result);
                };
                reader.readAsDataURL(file);
            } else {
                setFilePreview(null);
            }
        }
    };

    const clearSelectedFile = () => {
        setSelectedFile(null);
        setFilePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return dateString;
        }
        return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const oneDay = 24 * 60 * 60 * 1000;

        if (diff < oneDay && date.getDate() === now.getDate()) {
            return formatTime(dateString);
        } else if (diff < 2 * oneDay) {
            return 'أمس';
        } else {
            return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
        }
    };

    const formatFullDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const oneDay = 24 * 60 * 60 * 1000;

        if (diff < oneDay && date.getDate() === now.getDate()) {
            return 'اليوم';
        } else if (diff < 2 * oneDay && date.getDate() === now.getDate() - 1) {
            return 'أمس';
        } else {
            return date.toLocaleDateString('ar-EG', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
            });
        }
    };

    const getDateKey = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    };

    const getStatusIcon = (status, direction) => {
        if (direction !== 'outgoing') return null;

        switch (status) {
            case 'read':
                return <CheckCheck size={14} color="#53bdeb" />;
            case 'delivered':
                return <CheckCheck size={14} />;
            case 'sent':
                return <Check size={14} />;
            case 'pending':
                return <Check size={14} style={{ opacity: 0.5 }} />;
            case 'failed':
                return <X size={14} color="hsl(var(--color-destructive))" />;
            default:
                return <Check size={14} />;
        }
    };

    const getDisplayName = (conv) => {
        if (conv.profile_name) {
            return conv.profile_name;
        }
        return conv.contact;
    };

    const getProfileImage = (conv) => {
        if (conv.profile_picture_url) {
            return (
                <img
                    src={conv.profile_picture_url}
                    alt={getDisplayName(conv)}
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        objectFit: 'cover'
                    }}
                    onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                    }}
                />
            );
        }
        return null;
    };

    const renderMessageContent = (msg) => {
        const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.message_type);

        if (isMedia && msg.media_id) {
            const mediaUrl = api.getMediaDownloadUrl(msg.media_id, msg.tenant_id || selectedChat?.tenant_id);

            if (msg.message_type === 'image') {
                return (
                    <div>
                        <img
                            src={mediaUrl}
                            alt="صورة"
                            style={{
                                maxWidth: '100%',
                                maxHeight: '300px',
                                borderRadius: '0.5rem',
                                marginBottom: msg.content ? '0.5rem' : 0
                            }}
                            onError={(e) => {
                                e.target.style.display = 'none';
                            }}
                        />
                        {msg.content && !msg.content.startsWith('[') && <div>{msg.content}</div>}
                    </div>
                );
            }

            if (msg.message_type === 'video') {
                return (
                    <div style={{ position: 'relative' }}>
                        <div style={{
                            background: 'hsl(var(--color-background))',
                            borderRadius: '0.5rem',
                            padding: '2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer'
                        }}
                            onClick={() => window.open(mediaUrl, '_blank')}
                        >
                            <Play size={24} />
                            <span>فيديو</span>
                        </div>
                        {msg.content && !msg.content.startsWith('[') && <div style={{ marginTop: '0.5rem' }}>{msg.content}</div>}
                    </div>
                );
            }

            if (msg.message_type === 'document') {
                return (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem',
                            background: 'hsl(var(--color-background))',
                            borderRadius: '0.5rem',
                            cursor: 'pointer'
                        }}
                        onClick={() => window.open(mediaUrl, '_blank')}
                    >
                        <File size={24} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.85rem' }}>{msg.content || 'مستند'}</div>
                        </div>
                        <Download size={18} />
                    </div>
                );
            }

            if (msg.message_type === 'audio') {
                return (
                    <audio controls style={{ maxWidth: '100%' }}>
                        <source src={mediaUrl} type={msg.media_mime_type || 'audio/ogg'} />
                        المتصفح لا يدعم تشغيل الصوت
                    </audio>
                );
            }
        }

        // Text message or fallback
        return <div>{msg.content}</div>;
    };

    const filteredConversations = conversations.filter(conv => {
        const searchLower = searchTerm.toLowerCase();
        return (
            conv.contact?.toLowerCase().includes(searchLower) ||
            conv.profile_name?.toLowerCase().includes(searchLower) ||
            conv.last_message?.toLowerCase().includes(searchLower)
        );
    });

    return (
        <div style={{
            height: 'calc(100vh - 100px)',
            display: 'flex',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            border: '1px solid hsl(var(--color-secondary))',
            background: 'hsl(var(--color-card))'
        }}>
            {/* Sidebar List */}
            <div style={{
                width: '350px',
                borderLeft: '1px solid hsl(var(--color-secondary))',
                display: 'flex',
                flexDirection: 'column',
                background: 'hsl(var(--color-card))'
            }}>
                {/* Header */}
                <div style={{
                    padding: '1rem',
                    background: 'hsl(var(--color-secondary) / 0.3)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid hsl(var(--color-secondary))'
                }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>المحادثات</div>
                    <div style={{ display: 'flex', gap: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>
                        <MoreVertical size={20} style={{ cursor: 'pointer' }} />
                    </div>
                </div>

                {/* Search */}
                <div style={{ padding: '0.75rem', borderBottom: '1px solid hsl(var(--color-secondary))' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'hsl(var(--color-background))',
                        borderRadius: 'var(--radius)',
                        padding: '0.5rem 0.75rem',
                        gap: '0.5rem',
                        border: '1px solid hsl(var(--color-secondary))'
                    }}>
                        <Search size={18} color="hsl(var(--color-muted-foreground))" />
                        <input
                            type="text"
                            placeholder="بحث في المحادثات..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                padding: 0,
                                fontSize: '0.9rem',
                                outline: 'none',
                                flex: 1
                            }}
                        />
                    </div>
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--color-muted-foreground))' }}>
                            جاري التحميل...
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--color-muted-foreground))' }}>
                            لا توجد محادثات
                        </div>
                    ) : (
                        filteredConversations.map((conv, idx) => (
                            <div
                                key={idx}
                                onClick={() => setSelectedChat(conv)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0.75rem 1rem',
                                    cursor: 'pointer',
                                    background: (selectedChat?.contact === conv.contact && selectedChat?.tenant_id === conv.tenant_id) ? 'hsl(var(--color-secondary) / 0.5)' : 'transparent',
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid hsl(var(--color-secondary) / 0.5)'
                                }}
                            >
                                {/* Profile Picture */}
                                <div style={{
                                    width: '45px',
                                    height: '45px',
                                    borderRadius: '50%',
                                    background: 'hsl(var(--color-secondary))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginLeft: '0.75rem',
                                    flexShrink: 0,
                                    overflow: 'hidden',
                                    position: 'relative'
                                }}>
                                    {getProfileImage(conv)}
                                    <span style={{
                                        fontSize: '1.2rem',
                                        display: conv.profile_picture_url ? 'none' : 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '100%',
                                        height: '100%'
                                    }}>👤</span>
                                </div>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'hsl(var(--color-foreground))' }}>
                                            {getDisplayName(conv)}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>
                                            {formatDate(conv.last_interaction)}
                                        </span>
                                    </div>
                                    {/* Show phone number if profile name exists */}
                                    {conv.profile_name && (
                                        <div style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))', marginBottom: '0.15rem', direction: 'ltr', textAlign: 'right' }}>
                                            {conv.contact}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: '0.85rem',
                                            color: 'hsl(var(--color-muted-foreground))',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '180px',
                                            display: 'block'
                                        }}>
                                            {conv.last_message || 'صورة/ملف'}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            {conv.tenant_name && (
                                                <span style={{
                                                    fontSize: '0.65rem',
                                                    background: 'hsl(var(--color-primary) / 0.1)',
                                                    color: 'hsl(var(--color-primary))',
                                                    padding: '2px 4px',
                                                    borderRadius: '3px',
                                                    whiteSpace: 'nowrap',
                                                    border: '1px solid hsl(var(--color-primary) / 0.2)'
                                                }}>
                                                    {conv.tenant_name}
                                                </span>
                                            )}
                                            {conv.unread_count > 0 && (
                                                <span style={{
                                                    background: 'hsl(var(--color-success))',
                                                    color: 'white',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 'bold',
                                                    padding: '0.1rem 0.4rem',
                                                    borderRadius: '10px',
                                                    minWidth: '18px',
                                                    textAlign: 'center'
                                                }}>
                                                    {conv.unread_count}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            {selectedChat ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'hsl(var(--color-background))' }}>
                    {/* Header */}
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: 'hsl(var(--color-secondary) / 0.3)',
                        borderBottom: '1px solid hsl(var(--color-secondary))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                background: 'hsl(var(--color-secondary))',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden'
                            }}>
                                {getProfileImage(selectedChat)}
                                <span style={{
                                    display: selectedChat.profile_picture_url ? 'none' : 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>👤</span>
                            </div>
                            <div>
                                <div style={{ fontWeight: 600 }}>{getDisplayName(selectedChat)}</div>
                                {selectedChat.profile_name && (
                                    <div style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))', direction: 'ltr' }}>
                                        {selectedChat.contact}
                                    </div>
                                )}
                                {!selectedChat.profile_name && (
                                    <div style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>متصل</div>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1.5rem', color: 'hsl(var(--color-muted-foreground))' }}>
                            <Search size={20} style={{ cursor: 'pointer' }} />
                            <MoreVertical size={20} style={{ cursor: 'pointer' }} />
                        </div>
                    </div>

                    {/* Messages */}
                    <div style={{
                        flex: 1,
                        backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                        backgroundRepeat: 'repeat',
                        backgroundSize: '400px',
                        backgroundColor: 'hsl(var(--color-background))',
                        backgroundBlendMode: 'overlay',
                        padding: '1rem',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem'
                    }}>
                        {messages.map((msg, idx) => {
                            const prevMsg = messages[idx - 1];
                            const showDateSeparator = !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg.created_at);
                            const isNewSender = !prevMsg || prevMsg.direction !== msg.direction;

                            return (
                                <React.Fragment key={msg.id || idx}>
                                    {/* Date Separator */}
                                    {showDateSeparator && (
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            margin: '1rem 0'
                                        }}>
                                            <span style={{
                                                background: 'hsl(var(--color-card))',
                                                color: 'hsl(var(--color-muted-foreground))',
                                                padding: '0.35rem 1rem',
                                                borderRadius: '0.5rem',
                                                fontSize: '0.75rem',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                            }}>
                                                {formatFullDate(msg.created_at)}
                                            </span>
                                        </div>
                                    )}

                                    {/* Message Bubble */}
                                    <div
                                        style={{
                                            alignSelf: msg.direction === 'outgoing' ? 'flex-end' : 'flex-start',
                                            maxWidth: '65%',
                                            position: 'relative',
                                            marginTop: isNewSender && !showDateSeparator ? '0.75rem' : '0.15rem'
                                        }}
                                    >
                                        <div style={{
                                            padding: '0.5rem 0.75rem',
                                            borderRadius: '0.8rem',
                                            borderTopRightRadius: msg.direction === 'outgoing' ? 0 : '0.8rem',
                                            borderTopLeftRadius: msg.direction === 'outgoing' ? '0.8rem' : 0,
                                            background: msg.direction === 'outgoing' ? 'hsl(var(--color-success) / 0.3)' : 'hsl(var(--color-secondary))',
                                            color: 'hsl(var(--color-foreground))',
                                            border: `1px solid ${msg.direction === 'outgoing' ? 'hsl(var(--color-success) / 0.2)' : 'hsl(var(--color-secondary))'}`,
                                            fontSize: '0.93rem',
                                            lineHeight: 1.4,
                                            boxShadow: '0 1px 1px rgba(0,0,0,0.05)'
                                        }}>
                                            {renderMessageContent(msg)}
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'flex-end',
                                                alignItems: 'center',
                                                gap: '0.25rem',
                                                marginTop: '0.25rem',
                                                fontSize: '0.65rem',
                                                color: 'hsl(var(--color-muted-foreground))',
                                                opacity: 0.8
                                            }}>
                                                {formatTime(msg.created_at)}
                                                {getStatusIcon(msg.status, msg.direction)}
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* File Preview */}
                    {selectedFile && (
                        <div style={{
                            padding: '0.5rem 1rem',
                            background: 'hsl(var(--color-secondary) / 0.5)',
                            borderTop: '1px solid hsl(var(--color-secondary))',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            {filePreview ? (
                                <img src={filePreview} alt="معاينة" style={{ height: '60px', borderRadius: '0.5rem' }} />
                            ) : (
                                <div style={{
                                    width: '60px',
                                    height: '60px',
                                    background: 'hsl(var(--color-background))',
                                    borderRadius: '0.5rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <File size={24} />
                                </div>
                            )}
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{selectedFile.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>
                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                </div>
                            </div>
                            <button
                                onClick={clearSelectedFile}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'hsl(var(--color-muted-foreground))',
                                    cursor: 'pointer',
                                    padding: '0.5rem'
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>
                    )}

                    {/* Error Message */}
                    {sendError && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            background: 'hsl(var(--color-destructive) / 0.15)',
                            borderTop: '1px solid hsl(var(--color-destructive) / 0.3)',
                            color: 'hsl(var(--color-destructive))',
                            fontSize: '0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem'
                        }}>
                            <span>{sendError}</span>
                            <button
                                onClick={() => setSendError(null)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'hsl(var(--color-destructive))',
                                    cursor: 'pointer',
                                    padding: '0.25rem'
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}

                    {/* Input */}
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: 'hsl(var(--color-secondary) / 0.3)',
                        borderTop: '1px solid hsl(var(--color-secondary))',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem'
                    }}>
                        <div style={{ display: 'flex', gap: '1rem', color: 'hsl(var(--color-muted-foreground))', position: 'relative' }}>
                            <Smile size={24} style={{ cursor: 'pointer' }} />
                            <div style={{ position: 'relative' }}>
                                <Paperclip
                                    size={22}
                                    style={{ cursor: 'pointer', transform: 'rotate(45deg)' }}
                                    onClick={() => setShowAttachMenu(!showAttachMenu)}
                                />
                                {showAttachMenu && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: '100%',
                                        right: 0,
                                        marginBottom: '0.5rem',
                                        background: 'hsl(var(--color-card))',
                                        border: '1px solid hsl(var(--color-secondary))',
                                        borderRadius: 'var(--radius)',
                                        padding: '0.5rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem',
                                        minWidth: '150px',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                        zIndex: 10
                                    }}>
                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.5rem',
                                            cursor: 'pointer',
                                            borderRadius: '0.25rem',
                                            transition: 'background 0.2s'
                                        }}>
                                            <ImageIcon size={18} color="hsl(var(--color-accent))" />
                                            <span style={{ fontSize: '0.9rem' }}>صورة</span>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*"
                                                onChange={handleFileSelect}
                                                style={{ display: 'none' }}
                                            />
                                        </label>
                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.5rem',
                                            cursor: 'pointer',
                                            borderRadius: '0.25rem',
                                            transition: 'background 0.2s'
                                        }}>
                                            <File size={18} color="hsl(var(--color-success))" />
                                            <span style={{ fontSize: '0.9rem' }}>ملف</span>
                                            <input
                                                type="file"
                                                onChange={handleFileSelect}
                                                style={{ display: 'none' }}
                                            />
                                        </label>
                                    </div>
                                )}
                            </div>
                        </div>

                        <form onSubmit={handleSendMessage} style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="اكتب رسالة..."
                                style={{
                                    flex: 1,
                                    padding: '0.6rem 1rem',
                                    borderRadius: '0.5rem',
                                    background: 'hsl(var(--color-background))',
                                    border: '1px solid hsl(var(--color-secondary))'
                                }}
                            />
                            {(newMessage.trim() || selectedFile) ? (
                                <button
                                    type="submit"
                                    className="button"
                                    disabled={sending}
                                    style={{
                                        background: 'hsl(var(--color-accent))',
                                        color: 'white',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '0.5rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.25rem'
                                    }}
                                >
                                    {sending ? 'جاري الإرسال...' : <Send size={20} />}
                                </button>
                            ) : (
                                <button type="button" className="button" style={{ background: 'transparent', color: 'hsl(var(--color-muted-foreground))', padding: '0.5rem' }}>
                                    <Mic size={24} />
                                </button>
                            )}
                        </form>
                    </div>
                </div>
            ) : (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'hsl(var(--color-background))',
                    borderBottom: '6px solid hsl(var(--color-success))',
                    color: 'hsl(var(--color-muted-foreground))',
                    gap: '1rem'
                }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        background: 'hsl(var(--color-secondary))',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '1rem'
                    }}>
                        <Phone size={40} />
                    </div>
                    <h2 style={{ color: 'hsl(var(--color-foreground))', fontWeight: 300 }}>WhatsApp for Business</h2>
                    <p style={{ maxWidth: '400px', textAlign: 'center', fontSize: '0.9rem', lineHeight: 1.6 }}>
                        اختر محادثة للبدء. يمكنك مراقبة وإدارة جميع رسائل عملائك من هذه الواجهة المركزية.
                    </p>
                </div>
            )}
        </div>
    );
};

export default WhatsAppChat;
