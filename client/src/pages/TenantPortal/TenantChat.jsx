import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Avatar,
    TextField,
    Paper,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Badge,
    InputAdornment,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Chip
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    MoreVert as MoreVertIcon,
    Search as SearchIcon,
    Send as SendIcon,
    InsertEmoticon as EmojiIcon,
    DoneAll as DoneAllIcon,
    Done as DoneIcon,
    Schedule as ScheduleIcon,
    Error as ErrorIcon,
    Description as TemplateIcon,
    AttachFile as AttachFileIcon,
    Close as CloseIcon,
    PictureAsPdf as PdfIcon,
    InsertDriveFile as FileIcon
} from '@mui/icons-material';
import api from '../../api';

import TemplatePicker from '../../components/WhatsApp/TemplatePicker';
import MessageBubble from '../../components/WhatsApp/MessageBubble';

const TenantChat = () => {
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showMobileChat, setShowMobileChat] = useState(false);

    // Template State
    const [templates, setTemplates] = useState([]);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);

    // Document State
    const [selectedFile, setSelectedFile] = useState(null);
    const [documentCaption, setDocumentCaption] = useState('');
    const [showDocumentDialog, setShowDocumentDialog] = useState(false);
    const [sendingDoc, setSendingDoc] = useState(false);
    const fileInputRef = useRef(null);

    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const isFirstLoad = useRef(true);

    useEffect(() => {
        fetchConversations();
        fetchTemplates();
    }, []);

    useEffect(() => {
        if (selectedChat) {
            isFirstLoad.current = true;
            fetchMessages(selectedChat.contact);
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
            setLoadingMessages(true);
            const data = await api.getPortalMessages(phone);
            setMessages(data);
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            setLoadingMessages(false);
        }
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
            // Instant scroll to bottom after sending
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 50);
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
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
            setShowTemplatePicker(false);
            await fetchMessages(selectedChat.contact);
            // Instant scroll to bottom after sending
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 50);
        } catch (err) {
            console.error('Failed to send template:', err);
            alert('فشل إرسال القالب');
        } finally {
            setSending(false);
        }
    };

    // Document handlers
    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain'
        ];

        if (!allowedTypes.includes(file.type)) {
            alert('نوع الملف غير مدعوم. يُسمح فقط: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT');
            e.target.value = '';
            return;
        }

        // Validate file size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert('حجم الملف كبير جداً. الحد الأقصى 10 ميجابايت');
            e.target.value = '';
            return;
        }

        setSelectedFile(file);
        setDocumentCaption('');
        setShowDocumentDialog(true);
        e.target.value = ''; // Reset input
    };

    const handleSendDocument = async () => {
        if (!selectedFile || !selectedChat || sendingDoc) return;

        try {
            setSendingDoc(true);
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('recipient', selectedChat.contact);
            formData.append('filename', selectedFile.name);
            if (documentCaption.trim()) {
                formData.append('caption', documentCaption.trim());
            }

            await api.sendPortalDocument(formData);
            
            setShowDocumentDialog(false);
            setSelectedFile(null);
            setDocumentCaption('');
            await fetchMessages(selectedChat.contact);
            // Instant scroll to bottom after sending
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 50);
        } catch (err) {
            console.error('Failed to send document:', err);
            alert('فشل إرسال الملف: ' + (err.message || 'خطأ غير متوقع'));
        } finally {
            setSendingDoc(false);
        }
    };

    const getFileIcon = (type) => {
        if (type === 'application/pdf') return <PdfIcon sx={{ fontSize: 40, color: 'error.main' }} />;
        return <FileIcon sx={{ fontSize: 40, color: 'primary.main' }} />;
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

    // Helper to get media URL (reusing admin API for now passed via props or context usually, but here accessing directly)
    // Note: Tenant needs their own media download endpoint if sensitive, but for now assuming shared or public-ish handling
    const getMediaDownloadUrl = (mediaId) => {
        return api.getMediaDownloadUrl(mediaId, null);
    };

    const filteredConversations = conversations.filter(conv =>
        (conv.profile_name || conv.contact || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Box sx={{ height: '100vh', display: 'flex', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Conversations List */}
            <Box sx={{
                width: { xs: showMobileChat ? 0 : '100%', md: 350 },
                height: '100%',
                display: { xs: showMobileChat ? 'none' : 'flex', md: 'flex' },
                flexShrink: 0,
                flexDirection: 'column',
                borderRight: '1px solid rgba(0,0,0,0.1)',
                bgcolor: 'background.paper'
            }}>
                {/* Search Header */}
                <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                        المحادثات
                    </Typography>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="بحث..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon color="action" />
                                </InputAdornment>
                            ),
                        }}
                    />
                </Box>

                {/* Conversations */}
                <Box sx={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress size={32} />
                        </Box>
                    ) : filteredConversations.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            <Typography>لا توجد محادثات</Typography>
                        </Box>
                    ) : (
                        <List disablePadding>
                            {filteredConversations.map((conv) => (
                                <ListItem
                                    key={conv.contact}
                                    component="div"
                                    onClick={() => {
                                        setSelectedChat(conv);
                                        setShowMobileChat(true);
                                    }}
                                    sx={{
                                        cursor: 'pointer',
                                        borderBottom: '1px solid rgba(0,0,0,0.05)',
                                        bgcolor: selectedChat?.contact === conv.contact ? 'action.selected' : 'transparent',
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                >
                                    <ListItemAvatar>
                                        <Badge
                                            badgeContent={conv.unread_count}
                                            color="success"
                                            overlap="circular"
                                        >
                                            <Avatar sx={{ bgcolor: 'primary.main' }}>
                                                {(conv.profile_name || conv.contact || '?')[0].toUpperCase()}
                                            </Avatar>
                                        </Badge>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={conv.profile_name || conv.contact}
                                        secondary={
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                                {conv.last_message?.substring(0, 30)}...
                                            </Typography>
                                        }
                                        primaryTypographyProps={{ fontWeight: conv.unread_count ? 700 : 400, noWrap: true }}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {formatDate(conv.last_interaction)}
                                    </Typography>
                                </ListItem>
                            ))}
                        </List>
                    )}
                </Box>
            </Box>

            {/* Chat Window */}
            <Box sx={{
                flex: 1,
                height: '100%',
                display: { xs: showMobileChat ? 'flex' : 'none', md: 'flex' },
                flexDirection: 'column',
                overflow: 'hidden',
                bgcolor: '#efeae2'
            }}>
                {!selectedChat ? (
                    <Box sx={{
                        flex: 1,
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
                ) : (
                    <>
                        {/* Chat Header */}
                        <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
                            <Toolbar sx={{ px: 1 }}>
                                <IconButton
                                    onClick={() => setShowMobileChat(false)}
                                    sx={{ mr: 1, display: { md: 'none' } }}
                                >
                                    <ArrowBackIcon />
                                </IconButton>

                                <Avatar sx={{ width: 40, height: 40, mr: 1.5, bgcolor: 'primary.main' }}>
                                    {getDisplayName(selectedChat)[0].toUpperCase()}
                                </Avatar>

                                <Box sx={{ flex: 1 }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                                        {getDisplayName(selectedChat)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {selectedChat.contact}
                                    </Typography>
                                </Box>

                                <IconButton><SearchIcon /></IconButton>
                                <IconButton><MoreVertIcon /></IconButton>
                            </Toolbar>
                        </AppBar>

                        {/* Messages Area */}
                        <Box
                            ref={messagesContainerRef}
                            sx={{
                                flex: 1,
                                overflowY: 'auto',
                                p: 2,
                                backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                                backgroundRepeat: 'repeat',
                                backgroundSize: '400px',
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            {loadingMessages ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                    <Typography variant="body2" sx={{ bgcolor: 'background.paper', px: 2, py: 0.5, borderRadius: 4, boxShadow: 1 }}>
                                        جاري تحميل الرسائل...
                                    </Typography>
                                </Box>
                            ) : (
                                messages.map((msg, idx) => {
                                    const prevMsg = messages[idx - 1];
                                    const showDateSeparator = !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg?.created_at);

                                    return (
                                        <React.Fragment key={msg.id || idx}>
                                            {showDateSeparator && (
                                                <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                                                    <Typography variant="caption" sx={{ bgcolor: 'secondary.light', color: 'secondary.contrastText', px: 1.5, py: 0.5, borderRadius: 2, opacity: 0.9 }}>
                                                        {getDateKey(msg.created_at)}
                                                    </Typography>
                                                </Box>
                                            )}
                                            <MessageBubble
                                                message={msg}
                                                isOutgoing={msg.direction === 'outgoing'}
                                                formatTime={formatTime}
                                                getStatusIcon={getStatusIcon}
                                                getMediaDownloadUrl={getMediaDownloadUrl}
                                            />
                                        </React.Fragment>
                                    );
                                })
                            )}
                            <div ref={messagesEndRef} />
                        </Box>

                        {/* Input Area */}
                        <Paper elevation={0} sx={{
                            p: 1.5,
                            mx: 1,
                            mb: 1,
                            bgcolor: 'background.paper',
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: 1,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                        }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <IconButton size="small"><EmojiIcon /></IconButton>
                                <IconButton size="small" onClick={() => setShowTemplatePicker(true)} title="قوالب الرسائل">
                                    <TemplateIcon />
                                </IconButton>
                                <IconButton size="small" onClick={() => fileInputRef.current?.click()} title="إرسال ملف">
                                    <AttachFileIcon sx={{ transform: 'rotate(45deg)' }} />
                                </IconButton>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                                    onChange={handleFileSelect}
                                />
                            </Box>

                            <TextField
                                fullWidth
                                size="small"
                                placeholder="اكتب رسالة..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                                multiline
                                maxRows={4}
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        borderRadius: 4,
                                        bgcolor: 'grey.50'
                                    }
                                }}
                            />

                            <IconButton
                                onClick={handleSendMessage}
                                disabled={sending || !newMessage.trim()}
                                sx={{
                                    bgcolor: 'primary.main',
                                    color: 'white',
                                    '&:hover': { bgcolor: 'primary.dark' },
                                    '&:disabled': { bgcolor: 'action.disabled', color: 'white' }
                                }}
                            >
                                {sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                            </IconButton>
                        </Paper>

                        {/* Document Preview Dialog */}
                        <Dialog open={showDocumentDialog} onClose={() => !sendingDoc && setShowDocumentDialog(false)} maxWidth="sm" fullWidth>
                            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                إرسال مستند
                                <IconButton onClick={() => setShowDocumentDialog(false)} disabled={sendingDoc}>
                                    <CloseIcon />
                                </IconButton>
                            </DialogTitle>
                            <DialogContent>
                                {selectedFile && (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {/* File Info */}
                                        <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                                            {getFileIcon(selectedFile.type)}
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Typography variant="subtitle2" noWrap>
                                                    {selectedFile.name}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {formatFileSize(selectedFile.size)}
                                                </Typography>
                                            </Box>
                                        </Paper>

                                        {/* Caption */}
                                        <TextField
                                            label="وصف الملف (اختياري)"
                                            placeholder="أضف وصفاً للملف..."
                                            value={documentCaption}
                                            onChange={(e) => setDocumentCaption(e.target.value)}
                                            multiline
                                            rows={2}
                                            fullWidth
                                        />
                                    </Box>
                                )}
                            </DialogContent>
                            <DialogActions>
                                <Button onClick={() => setShowDocumentDialog(false)} disabled={sendingDoc}>
                                    إلغاء
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleSendDocument}
                                    disabled={sendingDoc || !selectedFile}
                                    startIcon={sendingDoc ? <CircularProgress size={16} /> : <SendIcon />}
                                >
                                    {sendingDoc ? 'جاري الإرسال...' : 'إرسال'}
                                </Button>
                            </DialogActions>
                        </Dialog>

                        {/* Template Picker */}
                        <TemplatePicker
                            open={showTemplatePicker}
                            onClose={() => setShowTemplatePicker(false)}
                            onSelect={handleSendTemplate}
                            templates={templates}
                        />
                    </>
                )}
            </Box>
        </Box>
    );
};

export default TenantChat;
