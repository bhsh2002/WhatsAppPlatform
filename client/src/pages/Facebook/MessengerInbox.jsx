import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Box, Paper, Typography, Button, TextField, Avatar, IconButton,
    CircularProgress, Alert, Snackbar, Chip, Divider, useMediaQuery, useTheme,
    InputAdornment
} from '@mui/material';
import {
    Facebook as FacebookIcon, Send as SendIcon, Search as SearchIcon,
    Refresh as RefreshIcon, QuestionAnswer as MessengerIcon,
    Sync as SyncIcon, ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import api from '../../api';

const MessengerInbox = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [allPages, setAllPages] = useState([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [pagesLoading, setPagesLoading] = useState(true);

    const [conversations, setConversations] = useState([]);
    const [conversationsLoading, setConversationsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const [selectedConv, setSelectedConv] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);

    const [replyText, setReplyText] = useState('');
    const [sendingReply, setSendingReply] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const messagesEndRef = useRef(null);
    const selectedConvRef = useRef(null);

    const selectedPage = allPages.find(p => p.id === selectedPageId);

    useEffect(() => {
        selectedConvRef.current = selectedConv;
    }, [selectedConv]);

    const loadAllPages = useCallback(async () => {
        try {
            setPagesLoading(true);
            const data = await api.getFbAllPages();
            setAllPages(Array.isArray(data) ? data : []);
            if (data.length > 0 && !selectedPageId) {
                setSelectedPageId(data[0].id);
            }
        } catch (err) {
            console.error('Failed to load pages:', err);
        } finally {
            setPagesLoading(false);
        }
    }, []);

    useEffect(() => { loadAllPages(); }, [loadAllPages]);

    const loadConversations = useCallback(async () => {
        if (!selectedPageId) return;
        try {
            setConversationsLoading(true);
            const data = await api.getMessengerConversations(selectedPageId);
            setConversations(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load conversations:', err);
        } finally {
            setConversationsLoading(false);
        }
    }, [selectedPageId]);

    useEffect(() => {
        if (selectedPageId) loadConversations();
    }, [selectedPageId, loadConversations]);

    const loadMessages = useCallback(async () => {
        if (!selectedConv || !selectedPageId) return;
        try {
            setMessagesLoading(true);
            const data = await api.getMessengerMessages(selectedPageId, selectedConv.id);
            setMessages(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load messages:', err);
        } finally {
            setMessagesLoading(false);
        }
    }, [selectedConv, selectedPageId]);

    useEffect(() => {
        if (selectedConv) loadMessages();
    }, [selectedConv, loadMessages]);

    useEffect(() => {
        if (messages.length > 0) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    const handleSelectConv = async (conv) => {
        setSelectedConv(conv);
        if (conv.unread_count > 0 && selectedPageId) {
            try {
                await api.markMessengerRead(selectedPageId, conv.id);
                setConversations(prev => prev.map(c =>
                    c.id === conv.id ? { ...c, unread_count: 0 } : c
                ));
            } catch { /* best effort */ }
        }
        if (isMobile) {
            // On mobile, we want to show the chat window
        }
    };

    const handleSendReply = async () => {
        if (!replyText.trim() || !selectedConv || !selectedPageId) return;
        try {
            setSendingReply(true);
            await api.sendMessengerReply(selectedPageId, selectedConv.id, replyText.trim());
            setReplyText('');
            await loadMessages();
            await loadConversations();
            setSnackbar({ open: true, message: 'تم إرسال الرسالة', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إرسال الرسالة', severity: 'error' });
        } finally {
            setSendingReply(false);
        }
    };

    const handleSync = async () => {
        if (!selectedPageId) return;
        try {
            setSyncing(true);
            const result = await api.syncMessengerConversations(selectedPageId);
            setSnackbar({ open: true, message: `تمت المزامنة: ${result.synced_conversations || 0} محادثة، ${result.synced_messages || 0} رسالة`, severity: 'success' });
            await loadConversations();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشلت المزامنة', severity: 'error' });
        } finally {
            setSyncing(false);
        }
    };

    // SSE listener
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
                    console.warn('[SSE/Messenger] Failed to get SSE token');
                    reconnectTimeout = setTimeout(connectSSE, 5000);
                    return;
                }

                const { token } = await sseTokenRes.json();
                evtSource = new EventSource(`${baseUrl}/api/messages/events?token=${token}`);

                evtSource.addEventListener('fb_message:new', (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        loadConversations();
                        const current = selectedConvRef.current;
                        if (current && data.conversation_id === current.id) {
                            loadMessages();
                        }
                    } catch { /* ignore */ }
                });

                evtSource.onerror = () => {
                    evtSource?.close();
                    reconnectTimeout = setTimeout(connectSSE, 5000);
                };
            } catch {
                reconnectTimeout = setTimeout(connectSSE, 5000);
            }
        };

        connectSSE();
        return () => {
            evtSource?.close();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [loadConversations, loadMessages]);

    const filteredConversations = conversations.filter(conv => {
        if (!searchTerm) return true;
        const name = (conv.user_name || '').toLowerCase();
        const psid = (conv.user_psid || '').toLowerCase();
        const term = searchTerm.toLowerCase();
        return name.includes(term) || psid.includes(term);
    });

    const formatTime = (ts) => {
        if (!ts) return '';
        try {
            const date = new Date(ts);
            const now = new Date();
            const diff = now - date;
            if (diff < 86400000 && date.getDate() === now.getDate()) {
                return date.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
            }
            if (diff < 172800000) return 'أمس';
            return date.toLocaleDateString('ar-LY', { month: 'short', day: 'numeric' });
        } catch { return ts; }
    };

    const formatMessageTime = (ts) => {
        if (!ts) return '';
        try { return new Date(ts).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    };

    const getDateKey = (ts) => {
        if (!ts) return 'unknown';
        const d = new Date(ts);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };

    if (pagesLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ height: { xs: 'calc(100vh - 48px)', md: '100vh' }, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Page selector header */}
            <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
                <MessengerIcon sx={{ color: '#0084ff', fontSize: 28 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>صندوق ماسنجر</Typography>
                </Box>
                <Box sx={{ minWidth: 200 }}>
                    <TextField
                        select
                        size="small"
                        fullWidth
                        value={selectedPageId}
                        onChange={(e) => { setSelectedPageId(e.target.value); setSelectedConv(null); }}
                        variant="outlined"
                    >
                        {allPages.map(page => (
                            <option key={page.id} value={page.id}>{page.page_name || page.page_id}</option>
                        ))}
                    </TextField>
                </Box>
                {selectedPageId && (
                    <Button size="small" startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />} onClick={handleSync} disabled={syncing}>
                        مزامنة
                    </Button>
                )}
            </Paper>

            <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Sidebar - Conversation List */}
                {(!isMobile || !selectedConv) && (
                    <Box sx={{
                        width: { xs: '100%', md: 350, lg: 400 },
                        borderRight: { md: 1 },
                        borderColor: 'divider',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}>
                        <Box sx={{ p: 1.5 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="بحث في المحادثات..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                            />
                        </Box>

                        {conversationsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
                        ) : filteredConversations.length === 0 ? (
                            <Box sx={{ p: 4, textAlign: 'center' }}>
                                <MessengerIcon sx={{ fontSize: 48, color: '#0084ff', opacity: 0.3, mb: 1 }} />
                                <Typography color="text.secondary">لا توجد محادثات</Typography>
                                {selectedPageId && (
                                    <Button size="small" startIcon={<SyncIcon />} onClick={handleSync} sx={{ mt: 1 }}>مزامنة المحادثات</Button>
                                )}
                            </Box>
                        ) : (
                            <Box sx={{ flex: 1, overflowY: 'auto' }}>
                                {filteredConversations.map(conv => (
                                    <Box
                                        key={conv.id}
                                        onClick={() => handleSelectConv(conv)}
                                        sx={{
                                            p: 1.5, px: 2, cursor: 'pointer',
                                            bgcolor: selectedConv?.id === conv.id ? 'action.selected' : 'transparent',
                                            '&:hover': { bgcolor: 'action.hover' },
                                            borderBottom: 1, borderColor: 'divider',
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                                            <Avatar src={conv.user_profile_pic} sx={{ width: 48, height: 48, bgcolor: '#0084ff' }}>
                                                {conv.user_name?.charAt(0) || '?'}
                                            </Avatar>
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <Typography variant="subtitle2" fontWeight={conv.unread_count > 0 ? 700 : 400} noWrap>
                                                        {conv.user_name || conv.user_psid}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                                                        {formatTime(conv.last_message_time)}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                                                    <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
                                                        {conv.last_message || '—'}
                                                    </Typography>
                                                    {conv.unread_count > 0 && (
                                                        <Chip label={conv.unread_count} size="small" color="primary" sx={{ height: 20, minWidth: 20, ml: 1 }} />
                                                    )}
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}

                {/* Chat Window */}
                {(!isMobile || selectedConv) && (
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {!selectedConv ? (
                            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#f0f2f5', borderBottom: 4, borderColor: '#0084ff' }}>
                                <MessengerIcon sx={{ fontSize: 64, color: '#0084ff', opacity: 0.3, mb: 2 }} />
                                <Typography variant="h6" color="text.secondary">اختر محادثة للبدء</Typography>
                            </Box>
                        ) : (
                            <>
                                {/* Chat header */}
                                <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                                    {isMobile && (
                                        <IconButton onClick={() => setSelectedConv(null)}><ArrowBackIcon /></IconButton>
                                    )}
                                    <Avatar src={selectedConv.user_profile_pic} sx={{ bgcolor: '#0084ff' }}>
                                        {selectedConv.user_name?.charAt(0) || '?'}
                                    </Avatar>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="subtitle1" fontWeight={600}>{selectedConv.user_name || selectedConv.user_psid}</Typography>
                                        <Typography variant="caption" color="text.secondary">ماسنجر • {selectedPage?.page_name || selectedConv.page_id}</Typography>
                                    </Box>
                                    <IconButton onClick={() => { loadMessages(); loadConversations(); }}><RefreshIcon /></IconButton>
                                </Box>

                                {/* Messages area */}
                                <Box sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: '#f0f2f5' }}>
                                    {messagesLoading ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                                    ) : messages.length === 0 ? (
                                        <Box sx={{ textAlign: 'center', py: 4 }}>
                                            <Typography color="text.secondary">لا توجد رسائل</Typography>
                                        </Box>
                                    ) : (
                                        (() => {
                                            let lastDateKey = '';
                                            return messages.map((msg, idx) => {
                                                const isOutgoing = msg.direction === 'outgoing';
                                                const dateKey = getDateKey(msg.created_at);
                                                const showDateSep = dateKey !== lastDateKey;
                                                lastDateKey = dateKey;

                                                return (
                                                    <React.Fragment key={msg.id || idx}>
                                                        {showDateSep && (
                                                            <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                                                                <Chip label={msg.created_at ? new Date(msg.created_at).toLocaleDateString('ar-LY', { year: 'numeric', month: 'long', day: 'numeric' }) : ''} size="small" sx={{ bgcolor: 'background.paper' }} />
                                                            </Box>
                                                        )}
                                                        <Box sx={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', mb: 1, px: { xs: 0.5, md: 2 } }}>
                                                            <Paper elevation={1} sx={{
                                                                p: '6px 12px',
                                                                maxWidth: { xs: '85%', md: '65%' },
                                                                bgcolor: isOutgoing ? '#0084ff' : '#ffffff',
                                                                color: isOutgoing ? '#fff' : 'text.primary',
                                                                borderRadius: 2,
                                                                borderTopRightRadius: isOutgoing ? 0 : 2,
                                                                borderTopLeftRadius: !isOutgoing ? 0 : 2,
                                                                wordBreak: 'break-word',
                                                            }}>
                                                                {!isOutgoing && msg.sender_name && (
                                                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5, color: '#0084ff' }}>
                                                                        {msg.sender_name}
                                                                    </Typography>
                                                                )}
                                                                {msg.message_text && (
                                                                    <Typography variant="body2">{msg.message_text}</Typography>
                                                                )}
                                                                {msg.attachment_url && (
                                                                    <Box sx={{ mt: 1 }}>
                                                                        {msg.attachment_type === 'image' ? (
                                                                            <Box component="img" src={msg.attachment_url} sx={{ maxWidth: '100%', borderRadius: 1 }} />
                                                                        ) : (
                                                                            <Typography variant="body2" component="a" href={msg.attachment_url} target="_blank" rel="noopener" sx={{ wordBreak: 'break-all' }}>
                                                                                📎 {msg.attachment_type || 'مرفق'}
                                                                            </Typography>
                                                                        )}
                                                                    </Box>
                                                                )}
                                                                {msg.sticker_url && (
                                                                    <Box component="img" src={msg.sticker_url} sx={{ maxWidth: 150 }} />
                                                                )}
                                                                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, textAlign: 'left', opacity: 0.7, fontSize: '0.65rem' }}>
                                                                    {formatMessageTime(msg.created_at)}
                                                                </Typography>
                                                            </Paper>
                                                        </Box>
                                                    </React.Fragment>
                                                );
                                            });
                                        })()
                                    )}
                                    <div ref={messagesEndRef} />
                                </Box>

                                {/* Reply input */}
                                <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', gap: 1 }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="اكتب رداً..."
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                                        disabled={sendingReply}
                                        multiline
                                        maxRows={3}
                                    />
                                    <IconButton
                                        color="primary"
                                        onClick={handleSendReply}
                                        disabled={sendingReply || !replyText.trim()}
                                        sx={{ bgcolor: '#0084ff', color: 'white', '&:hover': { bgcolor: '#0066cc' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' } }}
                                    >
                                        {sendingReply ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <SendIcon />}
                                    </IconButton>
                                </Box>
                            </>
                        )}
                    </Box>
                )}
            </Box>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MessengerInbox;
