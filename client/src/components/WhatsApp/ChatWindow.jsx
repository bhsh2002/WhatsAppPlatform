import React, { useRef, useEffect } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    IconButton,
    Avatar,
    TextField,
    Paper,
    InputAdornment
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    MoreVert as MoreVertIcon,
    Search as SearchIcon,
    AttachFile as AttachFileIcon,
    Send as SendIcon,
    Mic as MicIcon,
    InsertEmoticon as EmojiIcon,
    Close as CloseIcon
} from '@mui/icons-material';
import TemplatePicker from './TemplatePicker';
import { Description as TemplateIcon } from '@mui/icons-material';

const ChatWindow = ({
    selectedChat,
    messages,
    loadingMessages,
    onBack, // Mobile back
    onSendMessage, // (text, file) => void
    newMessage,
    setNewMessage,
    // Refs for scrolling
    messagesEndRef,
    messagesContainerRef,
    // Helpers
    getProfileImage,
    getDisplayName,
    formatTime,
    getStatusIcon,
    getMediaDownloadUrl,
    // File handling
    selectedFile,
    setSelectedFile,
    filePreview,
    clearSelectedFile,
    handleFileSelect,
    getDateKey,
    fileInputRef,
    // Templates
    templates = [],
    onSendTemplate
}) => {
    const [showTemplatePicker, setShowTemplatePicker] = React.useState(false);

    // Handle form submit
    const handleSubmit = (e) => {
        e.preventDefault();
        onSendMessage();
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#efeae2' }}>
            {/* Header */}
            <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                <Toolbar sx={{ px: 1 }}>
                    <IconButton onClick={onBack} sx={{ mr: 1, display: { md: 'none' } }}>
                        <ArrowBackIcon />
                    </IconButton>

                    <Avatar sx={{ width: 40, height: 40, mr: 1.5, cursor: 'pointer' }}>
                        {selectedChat.profile_picture_url ? (
                            <img src={selectedChat.profile_picture_url} alt="" style={{ width: '100%', height: '100%' }} />
                        ) : '👤'}
                    </Avatar>

                    <Box sx={{ flex: 1, cursor: 'pointer' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                            {getDisplayName(selectedChat)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {selectedChat.profile_name ? selectedChat.contact : 'مشاهدة جهة الاتصال'}
                        </Typography>
                    </Box>

                    <Box sx={{ color: 'text.secondary' }}>
                        <IconButton><SearchIcon /></IconButton>
                        <IconButton><MoreVertIcon /></IconButton>
                    </Box>
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
                        const showDateSeparator = !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg.created_at);

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

            {/* File Preview */}
            {selectedFile && (
                <Paper sx={{ p: 1, borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 2 }}>
                    {filePreview ? (
                        <Box component="img" src={filePreview} sx={{ height: 60, borderRadius: 1 }} />
                    ) : (
                        <Box sx={{ width: 60, height: 60, bgcolor: 'background.default', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <AttachFileIcon />
                        </Box>
                    )}
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={600}>{selectedFile.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{(selectedFile.size / 1024).toFixed(1)} KB</Typography>
                    </Box>
                    <IconButton onClick={clearSelectedFile}><CloseIcon /></IconButton>
                </Paper>
            )}

            {/* Input Area */}
            <Paper elevation={0} sx={{
                p: 1,
                bgcolor: 'background.default',
                borderTop: '1px solid rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 1
            }}>
                <IconButton><EmojiIcon /></IconButton>
                <IconButton onClick={() => setShowTemplatePicker(true)}>
                    <TemplateIcon />
                </IconButton>
                <IconButton onClick={() => fileInputRef.current?.click()}>
                    <AttachFileIcon sx={{ transform: 'rotate(45deg)' }} />
                </IconButton>
                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                />

                <Box component="form" onSubmit={handleSubmit} sx={{ flex: 1, display: 'flex', gap: 1 }}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="اكتب رسالة..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        multiline
                        maxRows={4}
                        sx={{
                            bgcolor: 'background.paper',
                            '& .MuiOutlinedInput-root': { borderRadius: 2 }
                        }}
                    />

                    {newMessage.trim() || selectedFile ? (
                        <IconButton type="submit" color="primary" sx={{ circle: { r: 20 }, bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }}>
                            <SendIcon />
                        </IconButton>
                    ) : (
                        <IconButton><MicIcon /></IconButton>
                    )}
                </Box>
            </Paper>

            <TemplatePicker
                open={showTemplatePicker}
                onClose={() => setShowTemplatePicker(false)}
                onSelect={onSendTemplate}
                templates={templates}
            />
        </Box>
    );
};

export default ChatWindow;
