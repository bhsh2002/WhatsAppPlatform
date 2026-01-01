import React, { useState, useEffect, useRef } from 'react';
import { Search, Send, MoreVertical, Phone, Video, Paperclip, Smile, Image as ImageIcon, Mic, Check, CheckCheck } from 'lucide-react';
import api from '../../api';

const WhatsAppChat = () => {
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);

    // Fetch conversations on load
    useEffect(() => {
        fetchConversations();
        const interval = setInterval(fetchConversations, 10000); // Polling every 10s
        return () => clearInterval(interval);
    }, []);

    // Fetch messages when chat is selected
    useEffect(() => {
        if (selectedChat) {
            fetchMessages(selectedChat.contact);
            const interval = setInterval(() => fetchMessages(selectedChat.contact), 5000);
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

    const fetchMessages = async (contact) => {
        try {
            const data = await api.getThreadMessages(contact);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedChat) return;

        setSending(true);
        try {
            await api.sendMessage({
                recipient: selectedChat.contact,
                type: 'text',
                message: newMessage,
                // Assuming we use default tenant/creds for now as per system
                // logic in WhatsAppConsole.jsx if tenant_id is missing
            });

            setNewMessage('');
            fetchMessages(selectedChat.contact); // Refresh immediately
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setSending(false);
        }
    };

    const formatTime = (dateString, full = false) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            // If dateString is just time or invalid, try to parse or return as is
            return dateString;
        }
        return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

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
                            style={{
                                border: 'none',
                                background: 'transparent',
                                padding: 0,
                                fontSize: '0.9rem',
                                outline: 'none'
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
                    ) : conversations.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--color-muted-foreground))' }}>
                            لا توجد محادثات
                        </div>
                    ) : (
                        conversations.map((conv, idx) => (
                            <div
                                key={idx}
                                onClick={() => setSelectedChat(conv)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0.75rem 1rem',
                                    cursor: 'pointer',
                                    background: selectedChat?.contact === conv.contact ? 'hsl(var(--color-secondary) / 0.5)' : 'transparent',
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid hsl(var(--color-secondary) / 0.5)'
                                }}
                            >
                                <div style={{
                                    width: '45px',
                                    height: '45px',
                                    borderRadius: '50%',
                                    background: 'hsl(var(--color-secondary))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginLeft: '0.75rem',
                                    flexShrink: 0
                                }}>
                                    <span style={{ fontSize: '1.2rem' }}>👤</span>
                                </div>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'hsl(var(--color-foreground))' }}>
                                            {conv.contact}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>
                                            {formatTime(conv.last_interaction)}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: '0.85rem',
                                            color: 'hsl(var(--color-muted-foreground))',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '200px',
                                            display: 'block'
                                        }}>
                                            {conv.last_message || 'صورة/ملف'}
                                        </span>
                                        {conv.unread_count > 0 && (
                                            <span style={{
                                                background: 'hsl(var(--color-success))',
                                                color: 'white',
                                                fontSize: '0.7rem',
                                                fontWeight: 'bold',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '10px'
                                            }}>
                                                {conv.unread_count}
                                            </span>
                                        )}
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
                                justifyContent: 'center'
                            }}>
                                👤
                            </div>
                            <div>
                                <div style={{ fontWeight: 600 }}>{selectedChat.contact}</div>
                                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--color-muted-foreground))' }}>متصل</div>
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
                        backgroundColor: '#0b0b0f',
                        backgroundColor: 'hsl(var(--color-background))', // Fallback/Tint
                        backgroundBlendMode: 'overlay',
                        padding: '1rem',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                    }}>
                        {messages.map((msg, idx) => (
                            <div
                                key={msg.id || idx}
                                style={{
                                    alignSelf: msg.direction === 'outgoing' ? 'flex-end' : 'flex-start',
                                    maxWidth: '65%',
                                    position: 'relative',
                                    marginBottom: '4px'
                                }}
                            >
                                <div style={{
                                    padding: '0.4rem 0.6rem 0.5rem',
                                    borderRadius: '0.8rem',
                                    borderTopRightRadius: msg.direction === 'outgoing' ? 0 : '0.8rem',
                                    borderTopLeftRadius: msg.direction === 'outgoing' ? '0.8rem' : 0,
                                    background: msg.direction === 'outgoing' ? 'hsl(var(--color-success) / 0.3)' : 'hsl(var(--color-secondary))',
                                    color: msg.direction === 'outgoing' ? 'hsl(var(--color-foreground))' : 'hsl(var(--color-foreground))',
                                    border: `1px solid ${msg.direction === 'outgoing' ? 'hsl(var(--color-success) / 0.2)' : 'hsl(var(--color-secondary))'}`,
                                    fontSize: '0.93rem',
                                    lineHeight: 1.4
                                }}>
                                    {msg.content}
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'flex-end',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        marginTop: '0.2rem',
                                        fontSize: '0.65rem',
                                        color: 'hsl(var(--color-muted-foreground))',
                                        opacity: 0.8
                                    }}>
                                        {formatTime(msg.created_at)}
                                        {msg.direction === 'outgoing' && (
                                            msg.status === 'read' ? <CheckCheck size={14} color="#53bdeb" /> :
                                                msg.status === 'delivered' ? <CheckCheck size={14} /> :
                                                    <Check size={14} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: 'hsl(var(--color-secondary) / 0.3)',
                        borderTop: '1px solid hsl(var(--color-secondary))',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem'
                    }}>
                        <div style={{ display: 'flex', gap: '1rem', color: 'hsl(var(--color-muted-foreground))' }}>
                            <Smile size={24} style={{ cursor: 'pointer' }} />
                            <Paperclip size={22} style={{ cursor: 'pointer' }} />
                        </div>

                        <form onSubmit={handleSendMessage} style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="اكتب رسالة..."
                                style={{
                                    padding: '0.6rem 1rem',
                                    borderRadius: '0.5rem',
                                    background: 'hsl(var(--color-background))',
                                    border: '1px solid hsl(var(--color-secondary))'
                                }}
                            />
                            {newMessage.trim() ? (
                                <button
                                    type="submit"
                                    className="button"
                                    disabled={sending}
                                    style={{
                                        background: 'transparent',
                                        color: 'hsl(var(--color-accent))',
                                        padding: '0.5rem'
                                    }}
                                >
                                    <Send size={24} />
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
