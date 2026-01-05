import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Grid,
    Card,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Typography,
    TextField,
    IconButton,
    Badge,
    CircularProgress,
    Divider,
    Paper,
    InputAdornment,
    Chip
} from '@mui/material';
import {
    Send as SendIcon,
    Search as SearchIcon,
    Person as PersonIcon,
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon
} from '@mui/icons-material';
import api from '../../api';

const TenantChat = () => {
    const [conversations, setConversations] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        fetchConversations();
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const fetchConversations = async () => {
        try {
            setLoading(true);
            const data = await api.getPortalConversations();
            setConversations(data);
        } catch (error) {
            console.error('Failed to fetch conversations:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchMessages = async (phone) => {
        try {
            setMessagesLoading(true);
            const data = await api.getPortalMessages(phone);
            setMessages(data);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setMessagesLoading(false);
        }
    };

    const handleSelectContact = (contact) => {
        setSelectedContact(contact);
        fetchMessages(contact.contact);
    };

    const handleSendMessage = async () => {
        if (!newMessage.trim() || !selectedContact) return;

        try {
            setSending(true);
            await api.sendPortalMessage({
                recipient: selectedContact.contact,
                type: 'text',
                message: newMessage
            });
            setNewMessage('');
            // Refresh messages
            fetchMessages(selectedContact.contact);
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setSending(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'read': return <DoneAllIcon sx={{ fontSize: 14, color: 'primary.main' }} />;
            case 'delivered': return <DoneAllIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            case 'sent': return <DoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            case 'pending': return <ScheduleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
            default: return null;
        }
    };

    const formatTime = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();

        if (isToday) return 'اليوم';

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'أمس';

        return date.toLocaleDateString('ar-LY');
    };

    const filteredConversations = conversations.filter(c =>
        c.contact?.includes(searchTerm) ||
        c.profile_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Box sx={{ height: 'calc(100vh - 32px)', display: 'flex', p: 2 }}>
            <Grid container spacing={2} sx={{ height: '100%' }}>
                {/* Conversations List */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                            <Typography variant="h6" fontWeight={600} gutterBottom>
                                المحادثات
                            </Typography>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="بحث..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon />
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        </Box>

                        <List sx={{ flex: 1, overflow: 'auto', py: 0 }}>
                            {loading ? (
                                <Box sx={{ p: 4, textAlign: 'center' }}>
                                    <CircularProgress />
                                </Box>
                            ) : filteredConversations.length === 0 ? (
                                <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                                    لا توجد محادثات
                                </Box>
                            ) : (
                                filteredConversations.map((conv) => (
                                    <ListItem
                                        key={conv.contact}
                                        button
                                        selected={selectedContact?.contact === conv.contact}
                                        onClick={() => handleSelectContact(conv)}
                                        sx={{
                                            borderBottom: 1,
                                            borderColor: 'divider',
                                            '&.Mui-selected': {
                                                bgcolor: 'primary.light',
                                            }
                                        }}
                                    >
                                        <ListItemAvatar>
                                            <Badge
                                                badgeContent={conv.unread_count}
                                                color="error"
                                                invisible={!conv.unread_count}
                                            >
                                                <Avatar src={conv.profile_picture_url}>
                                                    <PersonIcon />
                                                </Avatar>
                                            </Badge>
                                        </ListItemAvatar>
                                        <ListItemText
                                            primary={conv.profile_name || conv.contact}
                                            secondary={
                                                <Typography variant="body2" color="text.secondary" noWrap>
                                                    {conv.last_message}
                                                </Typography>
                                            }
                                        />
                                        <Typography variant="caption" color="text.secondary">
                                            {formatDate(conv.last_interaction)}
                                        </Typography>
                                    </ListItem>
                                ))
                            )}
                        </List>
                    </Card>
                </Grid>

                {/* Chat Area */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {!selectedContact ? (
                            <Box sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'text.secondary'
                            }}>
                                <Typography>اختر محادثة للبدء</Typography>
                            </Box>
                        ) : (
                            <>
                                {/* Chat Header */}
                                <Box sx={{
                                    p: 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                    bgcolor: 'background.paper'
                                }}>
                                    <Avatar src={selectedContact.profile_picture_url}>
                                        <PersonIcon />
                                    </Avatar>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight={600}>
                                            {selectedContact.profile_name || selectedContact.contact}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {selectedContact.contact}
                                        </Typography>
                                    </Box>
                                </Box>

                                {/* Messages */}
                                <Box sx={{
                                    flex: 1,
                                    overflow: 'auto',
                                    p: 2,
                                    bgcolor: 'grey.50',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1
                                }}>
                                    {messagesLoading ? (
                                        <Box sx={{ textAlign: 'center', py: 4 }}>
                                            <CircularProgress />
                                        </Box>
                                    ) : messages.length === 0 ? (
                                        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                                            لا توجد رسائل
                                        </Box>
                                    ) : (
                                        messages.map((msg) => (
                                            <Box
                                                key={msg.id}
                                                sx={{
                                                    display: 'flex',
                                                    justifyContent: msg.direction === 'outgoing' ? 'flex-start' : 'flex-end',
                                                }}
                                            >
                                                <Paper
                                                    elevation={1}
                                                    sx={{
                                                        p: 1.5,
                                                        maxWidth: '70%',
                                                        bgcolor: msg.direction === 'outgoing' ? 'primary.light' : 'white',
                                                        borderRadius: 2,
                                                    }}
                                                >
                                                    <Typography variant="body2">
                                                        {msg.content}
                                                    </Typography>
                                                    <Box sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'flex-end',
                                                        gap: 0.5,
                                                        mt: 0.5
                                                    }}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {formatTime(msg.created_at)}
                                                        </Typography>
                                                        {msg.direction === 'outgoing' && getStatusIcon(msg.status)}
                                                    </Box>
                                                </Paper>
                                            </Box>
                                        ))
                                    )}
                                    <div ref={messagesEndRef} />
                                </Box>

                                {/* Input */}
                                <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <TextField
                                            fullWidth
                                            placeholder="اكتب رسالتك..."
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            onKeyPress={handleKeyPress}
                                            multiline
                                            maxRows={4}
                                            disabled={sending}
                                        />
                                        <IconButton
                                            color="primary"
                                            onClick={handleSendMessage}
                                            disabled={!newMessage.trim() || sending}
                                            sx={{
                                                bgcolor: 'primary.main',
                                                color: 'white',
                                                '&:hover': { bgcolor: 'primary.dark' },
                                                '&.Mui-disabled': { bgcolor: 'grey.300' }
                                            }}
                                        >
                                            {sending ? <CircularProgress size={24} color="inherit" /> : <SendIcon />}
                                        </IconButton>
                                    </Box>
                                </Box>
                            </>
                        )}
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default TenantChat;
