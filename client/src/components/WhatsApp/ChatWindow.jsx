import React, { useState, useRef } from 'react';
import { Box, AppBar, Toolbar, Typography, IconButton, Avatar, TextField, Paper, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert, Chip, Menu, MenuItem, ListItemIcon, ListItemText, useMediaQuery, useTheme, Tooltip } from '@mui/material';
import { ArrowBack as ArrowBackIcon, MoreVert as MoreVertIcon, Search as SearchIcon, Send as SendIcon, Description as TemplateIcon, AttachFile as AttachFileIcon, Image as ImageIcon, Close as CloseIcon, PictureAsPdf as PdfIcon, InsertDriveFile as FileIcon, SmartButton as InteractiveIcon, AddCircleOutline as MoreActionsIcon, Inventory2 as ProductIcon } from '@mui/icons-material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TemplatePicker from './TemplatePicker';
import MessageBubble from './MessageBubble';
import InteractiveMessageDialog from './InteractiveMessageDialog';
import IntegratedProductPicker from '../Inbox/IntegratedProductPicker';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const ChatWindow = ({
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
  sending = false,
  sendingDoc = false,
  sendingInteractive = false,
  messagesEndRef,
  messagesContainerRef,
  getDisplayName,
  formatTime,
  getStatusIcon,
  getMediaDownloadUrl,
  getDateKey,
  templates = [],
  windowStatus = null,
  integrationProducts = [],
  productCapability = null
}) => {
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showInteractiveDialog, setShowInteractiveDialog] = useState(false);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState(null);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Document/Image state
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileCaption, setFileCaption] = useState('');
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // File handlers
  const handleDocumentSelect = e => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      alert(tx("auto.k_44eeba92e48b"));
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert(tx("auto.k_e94e7cf22bdb"));
      e.target.value = '';
      return;
    }
    setSelectedFile(file);
    setFileCaption('');
    setFilePreviewUrl(null);
    setShowFileDialog(true);
    e.target.value = '';
  };
  const handleImageSelect = e => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(tx("auto.k_d10b02bb2054"));
      e.target.value = '';
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      alert(tx("auto.k_3461df136eaf"));
      e.target.value = '';
      return;
    }

    // Create preview
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
  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };
  const handleSendInteractive = async data => {
    if (onSendInteractive) {
      await onSendInteractive(data);
      setShowInteractiveDialog(false);
    }
  };
  const getFileIcon = type => {
    if (type === 'application/pdf') return <PdfIcon sx={{
      fontSize: 40,
      color: 'error.main'
    }} />;
    return <FileIcon sx={{
      fontSize: 40,
      color: 'primary.main'
    }} />;
  };
  const formatFileSize = bytes => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
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
  const handleOpenProductPicker = () => {
    if (productCapability?.enabled) setShowProductPicker(true);
    setAttachMenuAnchor(null);
  };
  const hasCtwa = !!selectedChat.last_ctwa_clid;
  const ctwaDetails = hasCtwa ? [selectedChat.last_ctwa_source_type, selectedChat.last_ctwa_source_url, selectedChat.last_ctwa_received_at ? new Date(selectedChat.last_ctwa_received_at).toLocaleString(getCurrentLocale()) : null, selectedChat.last_ctwa_clid].filter(Boolean).join(' • ') : tx("auto.k_8970d1222141");
  return <Box sx={{
    height: '100%',
    width: '100%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    bgcolor: '#efeae2'
  }}>
            {/* Chat Header */}
            <AppBar position="static" color="default" elevation={1} sx={{
      bgcolor: 'background.paper',
      flexShrink: 0
    }}>
                <Toolbar sx={{
        px: 1
      }}>
                    <IconButton aria-label="Back to conversations" onClick={onBack} sx={{
          mr: 1,
          display: {
            md: 'none'
          }
        }}>

                        <ArrowBackIcon />
                    </IconButton>

                    <Avatar sx={{
          width: 40,
          height: 40,
          mr: 1.5,
          bgcolor: 'primary.main'
        }}>
                        {selectedChat.profile_picture_url ? <img src={selectedChat.profile_picture_url} alt="" style={{
            width: '100%',
            height: '100%'
          }} /> : getDisplayName(selectedChat)[0].toUpperCase()}
                    </Avatar>

                    <Box sx={{
          flex: 1,
          minWidth: 0
        }}>
                        <Typography variant="subtitle1" sx={{
            fontWeight: 600,
            lineHeight: 1.2
          }}>
                            {getDisplayName(selectedChat)}
                        </Typography>
                        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            flexWrap: 'wrap'
          }}>
                            <Typography variant="caption" color="text.secondary">
                                {selectedChat.contact}
                            </Typography>
                            <Tooltip title={ctwaDetails}>
                                <Chip label={hasCtwa ? tx("auto.k_c04a50a4783b") : tx("auto.k_a4249c155b85")} size="small" color={hasCtwa ? 'success' : 'default'} variant="outlined" sx={{
                height: 20,
                fontSize: 11
              }} />

                            </Tooltip>
                        </Box>
                        {hasCtwa && <Typography variant="caption" color="text.secondary" noWrap sx={{
            display: 'block',
            maxWidth: {
              xs: 220,
              md: 520
            }
          }}>
                                {selectedChat.last_ctwa_source_type || 'source'}
                                {selectedChat.last_ctwa_received_at ? ` • ${new Date(selectedChat.last_ctwa_received_at).toLocaleString(getCurrentLocale())}` : ''}
                            </Typography>}
                    </Box>

                    <IconButton aria-label="Search conversation"><SearchIcon /></IconButton>
                    <IconButton aria-label="Conversation options"><MoreVertIcon /></IconButton>
                </Toolbar>
            </AppBar>

            {/* Messages Area */}
            <Box ref={messagesContainerRef} sx={{
      flex: 1,
      overflowY: 'auto',
      p: {
        xs: 1,
        md: 2
      },
      backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
      backgroundRepeat: 'repeat',
      backgroundSize: '400px',
      display: 'flex',
      flexDirection: 'column'
    }}>

                {loadingMessages ? <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        p: 4
      }}>
                        <Typography variant="body2" sx={{
          bgcolor: 'background.paper',
          px: 2,
          py: 0.5,
          borderRadius: 4,
          boxShadow: 1
        }}>{tx("auto.k_bbe3b08c177e")}

          </Typography>
                    </Box> : messages.map((msg, idx) => {
        const prevMsg = messages[idx - 1];
        const showDateSeparator = !prevMsg || getDateKey(msg.created_at) !== getDateKey(prevMsg?.created_at);
        return <React.Fragment key={msg.id || idx}>
                                {showDateSeparator && <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            my: 2
          }}>
                                        <Typography variant="caption" sx={{
              bgcolor: 'secondary.light',
              color: 'secondary.contrastText',
              px: 1.5,
              py: 0.5,
              borderRadius: 2,
              opacity: 0.9
            }}>
                                            {getDateKey(msg.created_at)}
                                        </Typography>
                                    </Box>}
                                <MessageBubble message={msg} isOutgoing={msg.direction === 'outgoing'} formatTime={formatTime} getStatusIcon={getStatusIcon} getMediaDownloadUrl={getMediaDownloadUrl} />

                            </React.Fragment>;
      })}
                <div ref={messagesEndRef} />
            </Box>

            {/* 24h Window Status */}
            {windowStatus && !windowStatus.is_open && <Alert severity="warning" icon={<AccessTimeIcon />} sx={{
      mx: 1,
      mb: 0.5,
      borderRadius: 2
    }}>{tx("auto.k_021c8c6eda8a")}


      </Alert>}
            {windowStatus && windowStatus.is_open && windowStatus.window_closes_at && <Chip icon={<AccessTimeIcon />} label={tx("auto.k_1b0fccf37063", {
      value1: new Date(windowStatus.window_closes_at).toLocaleTimeString(getCurrentLocale(), {
        hour: '2-digit',
        minute: '2-digit'
      })
    })} color="success" size="small" variant="outlined" sx={{
      mx: 2,
      mb: 0.5,
      alignSelf: 'center'
    }} />}

            {/* Input Area */}
            <Paper elevation={0} sx={{
      p: {
        xs: 1,
        md: 1.5
      },
      mx: {
        xs: 0.5,
        md: 1
      },
      mb: {
        xs: 0.5,
        md: 1
      },
      bgcolor: 'background.paper',
      borderRadius: 3,
      display: 'flex',
      alignItems: 'flex-end',
      gap: 1,
      boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
    }}>
                {isMobile ? <>
                        <IconButton size="small" aria-label="Open attachment menu" onClick={e => setAttachMenuAnchor(e.currentTarget)} sx={{
          flexShrink: 0
        }}>

                            <MoreActionsIcon />
                        </IconButton>
                        <Menu anchorEl={attachMenuAnchor} open={Boolean(attachMenuAnchor)} onClose={() => setAttachMenuAnchor(null)} anchorOrigin={{
          vertical: 'top',
          horizontal: theme.direction === 'rtl' ? 'left' : 'right'
        }} transformOrigin={{
          vertical: 'bottom',
          horizontal: theme.direction === 'rtl' ? 'left' : 'right'
        }}>

                            <MenuItem onClick={handleOpenTemplatePicker}>
                                <ListItemIcon><TemplateIcon fontSize="small" /></ListItemIcon>
                                <ListItemText>{tx("auto.k_1efe52278509")}</ListItemText>
                            </MenuItem>
                            {productCapability && <Tooltip title={productCapability.reason || ''} arrow placement="left">
                                <span><MenuItem onClick={handleOpenProductPicker} disabled={!productCapability.enabled}>
                                    <ListItemIcon><ProductIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>إدراج منتج مرتبط</ListItemText>
                                </MenuItem></span>
                            </Tooltip>}
                            <MenuItem onClick={handleOpenFilePicker}>
                                <ListItemIcon><AttachFileIcon fontSize="small" sx={{
                transform: 'rotate(45deg)'
              }} /></ListItemIcon>
                                <ListItemText>{tx("auto.k_ae09d61d9c93")}</ListItemText>
                            </MenuItem>
                            {onSendImage && <MenuItem onClick={handleOpenImagePicker}>
                                    <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>{tx("auto.k_df9bac60e9b6")}</ListItemText>
                                </MenuItem>}
                            {onSendInteractive && <MenuItem onClick={handleOpenInteractiveDialog}>
                                    <ListItemIcon><InteractiveIcon fontSize="small" /></ListItemIcon>
                                    <ListItemText>{tx("auto.k_c8f8c9313a7a")}</ListItemText>
                                </MenuItem>}
                        </Menu>
                    </> : <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5
      }}>
                        <IconButton size="small" onClick={() => setShowTemplatePicker(true)} title={tx("auto.k_1efe52278509")}>
                            <TemplateIcon />
                        </IconButton>
                        {productCapability && <Tooltip title={productCapability.reason || ''} arrow>
                            <span><IconButton size="small" onClick={() => setShowProductPicker(true)} disabled={!productCapability.enabled} aria-label="إدراج منتج مرتبط">
                                <ProductIcon />
                            </IconButton></span>
                        </Tooltip>}
                        <IconButton size="small" onClick={() => fileInputRef.current?.click()} title={tx("auto.k_ae09d61d9c93")}>
                            <AttachFileIcon sx={{
            transform: 'rotate(45deg)'
          }} />
                        </IconButton>
                        {onSendImage && <IconButton size="small" onClick={() => imageInputRef.current?.click()} title={tx("auto.k_df9bac60e9b6")}>
                                <ImageIcon />
                            </IconButton>}
                        {onSendInteractive && <IconButton size="small" onClick={() => setShowInteractiveDialog(true)} title={tx("auto.k_c8f8c9313a7a")}>
                                <InteractiveIcon />
                            </IconButton>}
                    </Box>}

                <TextField fullWidth size="small" placeholder={tx("auto.k_aa54ca9529fa")} value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={handleKeyDown} multiline maxRows={4} sx={{
        minWidth: 0,
        '& .MuiOutlinedInput-root': {
          borderRadius: 4,
          bgcolor: 'grey.50'
        }
      }} />


                <IconButton aria-label="Send message" onClick={onSendMessage} disabled={sending || !newMessage.trim()} sx={{
        flexShrink: 0,
        bgcolor: 'primary.main',
        color: 'white',
        '&:hover': {
          bgcolor: 'primary.dark'
        },
        '&:disabled': {
          bgcolor: 'action.disabled',
          color: 'white'
        }
      }}>

                    {sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                </IconButton>

                <input type="file" ref={fileInputRef} style={{
        display: 'none'
      }} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={handleDocumentSelect} />

                <input type="file" ref={imageInputRef} style={{
        display: 'none'
      }} accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} />

            </Paper>

            {/* File/Image Preview Dialog */}
            <Dialog open={showFileDialog} onClose={() => !sendingDoc && setShowFileDialog(false)} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': selectedFile?.type?.startsWith('image/') ? tx("auto.k_df9bac60e9b6") : tx("auto.k_f4e1e6f3d517") } }}>
                <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
                    {selectedFile?.type?.startsWith('image/') ? tx("auto.k_df9bac60e9b6") : tx("auto.k_f4e1e6f3d517")}
                    <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={() => setShowFileDialog(false)} disabled={sendingDoc}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {selectedFile && <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
                            {/* Preview */}
                            {filePreviewUrl ? <Box sx={{
            textAlign: 'center'
          }}>
                                    <Box component="img" src={filePreviewUrl} sx={{
              maxWidth: '100%',
              maxHeight: 300,
              borderRadius: 2,
              objectFit: 'contain'
            }} />

                                </Box> : <Paper variant="outlined" sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 2
          }}>
                                    {getFileIcon(selectedFile.type)}
                                    <Box sx={{
              flex: 1,
              minWidth: 0
            }}>
                                        <Typography variant="subtitle2" noWrap>
                                            {selectedFile.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {formatFileSize(selectedFile.size)}
                                        </Typography>
                                    </Box>
                                </Paper>}

                            {/* Caption */}
                            <TextField label={tx("auto.k_c822b55a6f45")} placeholder={tx("auto.k_3e82cec98eaf")} value={fileCaption} onChange={e => setFileCaption(e.target.value)} multiline rows={2} fullWidth />

                        </Box>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFileDialog(false)} disabled={sendingDoc}>{tx("auto.k_e776b0209b50")}

          </Button>
                    <Button variant="contained" onClick={handleSendFile} disabled={sendingDoc || !selectedFile} startIcon={sendingDoc ? <CircularProgress size={16} /> : <SendIcon />}>

                        {sendingDoc ? tx("auto.k_b303cc20c191") : tx("auto.k_90cf87a4177f")}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Template Picker */}
            <TemplatePicker open={showTemplatePicker} onClose={() => setShowTemplatePicker(false)} onSelect={onSendTemplate} templates={templates} />


            {/* Interactive Message Dialog */}
            <InteractiveMessageDialog open={showInteractiveDialog} onClose={() => setShowInteractiveDialog(false)} onSend={handleSendInteractive} sending={sendingInteractive} />
            {productCapability && <IntegratedProductPicker
                open={showProductPicker}
                onClose={() => setShowProductPicker(false)}
                products={integrationProducts}
                onSelect={message => setNewMessage(message)}
            />}

        </Box>;
};
export default ChatWindow;
