import React, { useState, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    IconButton,
    Avatar,
    Chip,
    CircularProgress,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Menu,
    MenuItem,
    ListItemIcon,
    ListItemText,
    useMediaQuery,
    useTheme
} from '@mui/material';
import {
    Send as SendIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    ArrowBack as ArrowBackIcon,
    Check as CheckIcon,
    DoneAll as DoneAllIcon,
    AccessTime as AccessTimeIcon,
    Error as ErrorIcon,
    InsertEmoticon as EmojiIcon,
    Description as TemplateIcon,
    AttachFile as AttachFileIcon,
    Image as ImageIcon,
    Close as CloseIcon,
    PictureAsPdf as PdfIcon,
    InsertDriveFile as FileIcon,
    SmartButton as InteractiveIcon,
    AddCircleOutline as MoreActionsIcon
} from '@mui/icons-material';
import MessageBubble from '../WhatsApp/MessageBubble';
import TemplatePicker from '../WhatsApp/TemplatePicker';
import InteractiveMessageDialog from '../WhatsApp/InteractiveMessageDialog';
import api from '../../api';

const formatTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
};

const getDateKey = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const defaultGetStatusIcon = (status, direction) => {
    if (direction !== 'outgoing') return null;
    switch (status) {
        case 'read': return <DoneAllIcon sx={{ color: '#53bdeb', fontSize: 'inherit' }} />;
        case 'delivered': return <DoneAllIcon sx={{ fontSize: 'inherit' }} />;
        case 'sent': return <CheckIcon sx={{ fontSize: 'inherit' }} />;
        case 'pending': return <AccessTimeIcon sx={{ opacity: 0.5, fontSize: 'inherit' }} />;
        case 'failed': return <ErrorIcon color="error" sx={{ fontSize: 'inherit' }} />;
        default: return <AccessTimeIcon sx={{ fontSize: 'inherit' }} />;
    }
};

const defaultGetMediaDownloadUrl = (mediaId, tenantId) => {
    if (!mediaId) return null;
    return api.getMediaDownloadUrl(mediaId, tenantId);
};

// Messenger message bubble
const MessengerBubble = ({ msg }) => {
    const isOutgoing = msg?.direction === 'outgoing';
    const content = msg?.message_text || '';

    return (
        <Box sx={{ display: 'flex', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', mb: 1 }}>
            <Paper sx={{
                maxWidth: '70%',
                p: 1.5,
                bgcolor: isOutgoing ? '#0084ff' : '#f0f0f0',
                color: isOutgoing ? 'white' : 'text.primary',
                borderRadius: 2,
            }}>
                {msg?.attachment_url && (
                    <Box sx={{ mb: content ? 0.5 : 0 }}>
                        {msg?.message_type === 'image' || (msg?.attachment_url && msg?.message_type !== 'file') ? (
                            <img src={msg.attachment_url} alt="" style={{ maxWidth: '100%', borderRadius: 4 }} />
                        ) : (
                            <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer"
                                style={{ color: isOutgoing ? 'white' : '#1976d2', textDecoration: 'underline' }}>
                                📄 ملف مرفق
                            </a>
                        )}
                    </Box>
                )}
                {msg?.sticker_url && (
                    <img src={msg.sticker_url} alt="sticker" style={{ maxWidth: 120 }} />
                )}
                {content && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content}
                    </Typography>
                )}
                <Typography variant="caption" sx={{
                    display: 'block',
                    textAlign: isOutgoing ? 'left' : 'right',
                    mt: 0.25,
                    opacity: 0.7,
                    fontSize: 10,
                }}>
                    {formatTime(msg?.created_at || '')}
                </Typography>
            </Paper>
        </Box>
    );
};

const UnifiedChatWindow = ({
    selectedChat,
    messages,
    loadingMessages,
    onBack,
    onSendMessage,
    onSendTemplate,
    onSendDocument,
    onSendImage,
    onSendInteractive,
    newMessage,
    setNewMessage,
    sending,
    sendingDoc = false,
    sendingInteractive = false,
    messagesEndRef,
    messagesContainerRef,
    getDisplayName,
    formatTime: formatTimeProp,
    getStatusIcon: getStatusIconProp,
    getMediaDownloadUrl: getMediaDownloadUrlProp,
    getDateKey: getDateKeyProp,
    templates = [],
    windowStatus = null,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const isWhatsApp = selectedChat?.channel === 'whatsapp';
    const channelColor = isWhatsApp ? '#25D366' : '#0084ff';
    const channelLabel = isWhatsApp ? 'واتساب' : 'ماسنجر';
    const ChannelIcon = isWhatsApp ? WhatsAppIcon : FacebookIcon;

    // Template picker state
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    // Interactive message dialog state
    const [showInteractiveDialog, setShowInteractiveDialog] = useState(false);
    // Attach menu (mobile)
    const [attachMenuAnchor, setAttachMenuAnchor] = useState(null);
    // File/Image attachment state
    const [selectedFile, setSelectedFile] = useState(null);
    const [fileCaption, setFileCaption] = useState('');
    const [showFileDialog, setShowFileDialog] = useState(false);
    const [filePreviewUrl, setFilePreviewUrl] = useState(null);
    const fileInputRef = useRef(null);
    const imageInputRef = useRef(null);

    if (!selectedChat) {
        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                width: '100%',
                bgcolor: 'grey.50',
                borderBottom: '4px solid #25D366',
            }}>
                <WhatsAppIcon sx={{ fontSize: 80, color: 'grey.300', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">اختر محادثة للبدء</Typography>
            </Box>
        );
    }

    const displayName = selectedChat.display_name || selectedChat.contact_id || 'غير معروف';
    const fTime = formatTimeProp || formatTime;
    const fGetDateKey = getDateKeyProp || getDateKey;
    const fGetStatusIcon = getStatusIconProp || defaultGetStatusIcon;
    const fGetMediaUrl = getMediaDownloadUrlProp || defaultGetMediaDownloadUrl;

    // Keyboard: Enter to send
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendMessage(newMessage);
        }
    };

    // File handlers
    const handleDocumentSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

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

        if (file.size > 10 * 1024 * 1024) {
            alert('حجم الملف كبير جداً. الحد الأقصى 10 ميجابايت');
            e.target.value = '';
            return;
        }

        setSelectedFile(file);
        setFileCaption('');
        setFilePreviewUrl(null);
        setShowFileDialog(true);
        e.target.value = '';
    };

    const handleImageSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            alert('نوع الصورة غير مدعوم. يُسمح فقط: JPG, PNG, WEBP');
            e.target.value = '';
            return;
        }

        if (file.size > 16 * 1024 * 1024) {
            alert('حجم الصورة كبير جداً. الحد الأقصى 16 ميجابايت');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => setFilePreviewUrl(reader.result);
        reader.readAsDataURL(file);

        setSelectedFile(file);
        setFileCaption('');
        setShowFileDialog(true);
        e.target.value = '';
    };

    const handleSendFile = async () => {
        if (!selectedFile || sendingDoc) return;
        const isImage = selectedFile.type.startsWith('image/');
        if (isImage && onSendImage) {
            await onSendImage(selectedFile, fileCaption.trim());
        } else if (onSendDocument) {
            await onSendDocument(selectedFile, fileCaption.trim());
        }
        setShowFileDialog(false);
        setSelectedFile(null);
        setFileCaption('');
        setFilePreviewUrl(null);
    };

    const handleSendInteractive = async (data) => {
        if (onSendInteractive) {
            await onSendInteractive(data);
            setShowInteractiveDialog(false);
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

    // Menu handlers
    const handleOpenTemplatePicker = () => {
        setShowTemplatePicker(true);
        setAttachMenuAnchor(null);
    };
    const handleOpenFilePicker = () => {
        fileInputRef.current?.click();
        setAttachMenuAnchor(null);
    };
    const handleOpenImagePicker = () => {
        imageInputRef.current?.click();
        setAttachMenuAnchor(null);
    };
    const handleOpenInteractiveDialog = () => {
        setShowInteractiveDialog(true);
        setAttachMenuAnchor(null);
    };

    let lastDateKey = null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                p: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
            }}>
                <IconButton sx={{ display: { md: 'none' } }} onClick={onBack}>
                    <ArrowBackIcon />
                </IconButton>
                <Avatar
                    src={selectedChat.avatar_url || undefined}
                    sx={{ bgcolor: selectedChat.avatar_url ? undefined : channelColor + '22', mr: 1.5 }}
                >
                    {displayName.charAt(0)?.toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="subtitle1" fontWeight="bold" noWrap>
                            {displayName}
                        </Typography>
                        <Chip
                            icon={<ChannelIcon sx={{ fontSize: 14 }} />}
                            label={channelLabel}
                            size="small"
                            sx={{
                                height: 20,
                                fontSize: 11,
                                borderColor: channelColor,
                                color: channelColor,
                                '& .MuiChip-icon': { color: channelColor },
                            }}
                            variant="outlined"
                        />
                    </Box>
                    <Typography variant="caption" color="text.secondary" noWrap>
                        {selectedChat.tenant_name && `${selectedChat.tenant_name} • `}
                        {selectedChat.contact_id}
                        {selectedChat.page_name && ` • ${selectedChat.page_name}`}
                    </Typography>
                </Box>
            </Box>

            {/* Messages */}
            <Box
                ref={messagesContainerRef}
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: { xs: 1, md: 2 },
                    bgcolor: isWhatsApp ? '#efeae2' : '#f0f2f5',
                    backgroundImage: isWhatsApp
                        ? 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")'
                        : 'none',
                    backgroundRepeat: 'repeat',
                    backgroundSize: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {loadingMessages ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : !messages || messages.length === 0 ? (
                    <Typography textAlign="center" color="text.secondary" sx={{ mt: 4 }}>
                        لا توجد رسائل
                    </Typography>
                ) : (
                    messages.map((msg, idx) => {
                        const dateKey = fGetDateKey(msg?.created_at || '');
                        const showDate = dateKey !== lastDateKey;
                        lastDateKey = dateKey;

                        return (
                            <React.Fragment key={msg?.id || idx}>
                                {showDate && (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                                        <Typography variant="caption" sx={{
                                            bgcolor: isWhatsApp ? 'secondary.light' : 'background.paper',
                                            color: isWhatsApp ? 'secondary.contrastText' : 'text.secondary',
                                            px: 1.5, py: 0.5, borderRadius: 2, opacity: 0.9,
                                        }}>
                                            {msg?.created_at ? new Date(msg.created_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                                        </Typography>
                                    </Box>
                                )}
                                {isWhatsApp ? (
                                    <MessageBubble
                                        message={msg}
                                        isOutgoing={msg?.direction === 'outgoing'}
                                        getDisplayName={getDisplayName}
                                        formatTime={fTime}
                                        getStatusIcon={fGetStatusIcon}
                                        getMediaDownloadUrl={fGetMediaUrl}
                                    />
                                ) : (
                                    <MessengerBubble msg={msg} />
                                )}
                            </React.Fragment>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </Box>

            {/* 24h Window Status (WhatsApp only) */}
            {isWhatsApp && windowStatus && !windowStatus.is_open && (
                <Alert
                    severity="warning"
                    icon={<AccessTimeIcon />}
                    sx={{ mx: 1, mb: 0.5, borderRadius: 2 }}
                >
                    نافذة المحادثة (24 ساعة) مغلقة — يمكنك فقط إرسال قوالب معتمدة.
                </Alert>
            )}
            {isWhatsApp && windowStatus && windowStatus.is_open && windowStatus.window_closes_at && (
                <Chip
                    icon={<AccessTimeIcon />}
                    label={`النافذة مفتوحة — تغلق ${new Date(windowStatus.window_closes_at).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' })}`}
                    color="success"
                    size="small"
                    variant="outlined"
                    sx={{ mx: 2, mb: 0.5, alignSelf: 'center' }}
                />
            )}

            {/* Input Area */}
            <Paper elevation={0} sx={{
                p: { xs: 1, md: 1.5 },
                mx: { xs: 0.5, md: 1 },
                mb: { xs: 0.5, md: 1 },
                bgcolor: 'background.paper',
                borderRadius: 3,
                display: 'flex',
                alignItems: 'flex-end',
                gap: 1,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
            }}>
                {/* Attachment buttons */}
                {isMobile ? (
                    <>
                        <IconButton
                            size="small"
                            onClick={(e) => setAttachMenuAnchor(e.currentTarget)}
                        >
                            <MoreActionsIcon />
                        </IconButton>
                        <Menu
                            anchorEl={attachMenuAnchor}
                            open={Boolean(attachMenuAnchor)}
                            onClose={() => setAttachMenuAnchor(null)}
                            anchorOrigin={{ vertical: 'top', horizontal: theme.direction === 'rtl' ? 'left' : 'right' }}
                            transformOrigin={{ vertical: 'bottom', horizontal: theme.direction === 'rtl' ? 'left' : 'right' }}
                        >
                            {isWhatsApp && onSendTemplate && (
                                <MenuItem onClick={handleOpenTemplatePicker}>
                                    <ListItemIcon><TemplateIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>قوالب الرسائل</ListItemText>
                                </MenuItem>
                            )}
                            {onSendDocument && (
                                <MenuItem onClick={handleOpenFilePicker}>
                                    <ListItemIcon><AttachFileIcon fontSize="small" sx={{ transform: 'rotate(45deg)' }} /></ListItemIcon>
                                    <ListItemText>إرسال ملف</ListItemText>
                                </MenuItem>
                            )}
                            {onSendImage && (
                                <MenuItem onClick={handleOpenImagePicker}>
                                    <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>إرسال صورة</ListItemText>
                                </MenuItem>
                            )}
                            {isWhatsApp && onSendInteractive && (
                                <MenuItem onClick={handleOpenInteractiveDialog}>
                                    <ListItemIcon><InteractiveIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>رسالة تفاعلية</ListItemText>
                                </MenuItem>
                            )}
                        </Menu>
                    </>
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <IconButton size="small"><EmojiIcon /></IconButton>
                        {isWhatsApp && onSendTemplate && (
                            <IconButton size="small" onClick={() => setShowTemplatePicker(true)} title="قوالب الرسائل">
                                <TemplateIcon />
                            </IconButton>
                        )}
                        {onSendDocument && (
                            <IconButton size="small" onClick={() => fileInputRef.current?.click()} title="إرسال ملف">
                                <AttachFileIcon sx={{ transform: 'rotate(45deg)' }} />
                            </IconButton>
                        )}
                        {onSendImage && (
                            <IconButton size="small" onClick={() => imageInputRef.current?.click()} title="إرسال صورة">
                                <ImageIcon />
                            </IconButton>
                        )}
                        {isWhatsApp && onSendInteractive && (
                            <IconButton size="small" onClick={() => setShowInteractiveDialog(true)} title="رسالة تفاعلية">
                                <InteractiveIcon />
                            </IconButton>
                        )}
                    </Box>
                )}

                {isMobile && (
                    <IconButton size="small"><EmojiIcon /></IconButton>
                )}

                <TextField
                    fullWidth
                    size="small"
                    placeholder={isWhatsApp ? "اكتب رسالة..." : "اكتب ردًا..."}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    multiline
                    maxRows={4}
                    disabled={sending}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            borderRadius: 4,
                            bgcolor: 'grey.50'
                        }
                    }}
                />

                <IconButton
                    onClick={() => onSendMessage(newMessage)}
                    disabled={sending || !newMessage?.trim()}
                    sx={{
                        bgcolor: 'primary.main',
                        color: 'white',
                        '&:hover': { bgcolor: 'primary.dark' },
                        '&:disabled': { bgcolor: 'action.disabled', color: 'white' }
                    }}
                >
                    {sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                </IconButton>

                {/* Hidden file inputs */}
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    onChange={handleDocumentSelect}
                />
                <input
                    type="file"
                    ref={imageInputRef}
                    style={{ display: 'none' }}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageSelect}
                />
            </Paper>

            {/* File/Image Preview Dialog */}
            <Dialog open={showFileDialog} onClose={() => !sendingDoc && setShowFileDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {selectedFile?.type?.startsWith('image/') ? 'إرسال صورة' : 'إرسال مستند'}
                    <IconButton onClick={() => setShowFileDialog(false)} disabled={sendingDoc}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {selectedFile && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {filePreviewUrl ? (
                                <Box sx={{ textAlign: 'center' }}>
                                    <Box
                                        component="img"
                                        src={filePreviewUrl}
                                        sx={{ maxWidth: '100%', maxHeight: 300, borderRadius: 2, objectFit: 'contain' }}
                                    />
                                </Box>
                            ) : (
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
                            )}
                            <TextField
                                label="وصف (اختياري)"
                                placeholder="أضف وصفاً..."
                                value={fileCaption}
                                onChange={(e) => setFileCaption(e.target.value)}
                                multiline
                                rows={2}
                                fullWidth
                            />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFileDialog(false)} disabled={sendingDoc}>
                        إلغاء
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleSendFile}
                        disabled={sendingDoc || !selectedFile}
                        startIcon={sendingDoc ? <CircularProgress size={16} /> : <SendIcon />}
                    >
                        {sendingDoc ? 'جاري الإرسال...' : 'إرسال'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Template Picker (WhatsApp only) */}
            {isWhatsApp && (
                <TemplatePicker
                    open={showTemplatePicker}
                    onClose={() => setShowTemplatePicker(false)}
                    onSelect={onSendTemplate}
                    templates={templates}
                />
            )}

            {/* Interactive Message Dialog (WhatsApp only) */}
            {isWhatsApp && (
                <InteractiveMessageDialog
                    open={showInteractiveDialog}
                    onClose={() => setShowInteractiveDialog(false)}
                    onSend={handleSendInteractive}
                    sending={sendingInteractive}
                />
            )}
        </Box>
    );
};

export default UnifiedChatWindow;