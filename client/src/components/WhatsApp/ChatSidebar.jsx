import React, { useState } from 'react';
import { Box, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, TextField, InputAdornment, Badge, CircularProgress, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import { Search as SearchIcon, ChatBubble as NewChatIcon, Close as CloseIcon, ContactPhone as ContactsIcon, Campaign as CampaignIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { tx } from "../../i18n/tx";
const ChatSidebar = ({
  conversations,
  selectedChat,
  onSelectChat,
  onNewChat,
  loading,
  searchTerm,
  setSearchTerm,
  getDisplayName,
  formatDate,
  // Navigation paths for contacts/broadcast pages
  contactsPath = '/contacts',
  broadcastPath = '/broadcast'
}) => {
  const navigate = useNavigate();
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const handleStartNewChat = () => {
    const phone = newChatPhone.replace(/[\s+-]/g, '').trim();
    if (!phone || phone.length < 9) {
      alert(tx("auto.k_5ae1471ef571"));
      return;
    }
    const newConv = {
      contact: phone,
      profile_name: null,
      last_message: null,
      last_interaction: new Date().toISOString(),
      unread_count: 0
    };
    if (onNewChat) {
      onNewChat(newConv);
    } else {
      onSelectChat(newConv);
    }
    setShowNewChatDialog(false);
    setNewChatPhone('');
  };
  return <Box sx={{
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid rgba(0,0,0,0.1)',
    bgcolor: 'background.paper'
  }}>
            {/* Search Header */}
            <Box sx={{
      p: {
        xs: 1,
        md: 2
      },
      borderBottom: '1px solid rgba(0,0,0,0.1)'
    }}>
                <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 1
      }}>
                    <Typography variant="h6" fontWeight={700}>{tx("auto.k_7fd699b82ef8")}

          </Typography>
                    <Box sx={{
          display: 'flex',
          gap: 1
        }}>
                        <Tooltip title={tx("auto.k_0bf69f9a30fb")}>
                            <IconButton onClick={() => navigate(broadcastPath)} size="small" sx={{
              bgcolor: 'secondary.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'secondary.dark'
              },
              width: 36,
              height: 36
            }}>

                                <CampaignIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={tx("auto.k_1c0785dfe87c")}>
                            <IconButton onClick={() => navigate(contactsPath)} size="small" sx={{
              bgcolor: 'grey.100',
              '&:hover': {
                bgcolor: 'grey.200'
              },
              width: 36,
              height: 36
            }}>

                                <ContactsIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={tx("auto.k_015d3289457b")}>
                            <IconButton onClick={() => setShowNewChatDialog(true)} size="small" sx={{
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'primary.dark'
              },
              width: 36,
              height: 36
            }}>

                                <NewChatIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>
                <TextField fullWidth size="small" placeholder={tx("auto.k_1d3863672e3e")} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} InputProps={{
        startAdornment: <InputAdornment position="start">
                                <SearchIcon color="action" />
                            </InputAdornment>
      }} />

            </Box>

            {/* Conversations */}
            <Box sx={{
      flex: 1,
      overflowY: 'auto'
    }}>
                {loading ? <Box sx={{
        display: 'flex',
        justifyContent: 'center',
        p: 4
      }}>
                        <CircularProgress size={32} />
                    </Box> : conversations.length === 0 ? <Box sx={{
        p: 4,
        textAlign: 'center',
        color: 'text.secondary'
      }}>
                        <Typography gutterBottom>{tx("auto.k_76172e0ff683")}</Typography>
                        <Button variant="outlined" size="small" startIcon={<NewChatIcon />} onClick={() => setShowNewChatDialog(true)}>{tx("auto.k_50daf2b8bb1e")}


          </Button>
                    </Box> : <List disablePadding>
                        {conversations.map((conv, idx) => {
          const isSelected = selectedChat?.contact === conv.contact && (selectedChat?.tenant_id === conv.tenant_id || !selectedChat?.tenant_id && !conv.tenant_id);
          const messagePreview = conv.last_message || (conv.last_message_type && conv.last_message_type !== 'text' ? tx("auto.k_4c9ba1b44a71") : tx("auto.k_8320b1bcc158"));
          return <ListItem key={conv.contact + '_' + (conv.tenant_id || idx)} component="div" onClick={() => onSelectChat(conv)} sx={{
            cursor: 'pointer',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            bgcolor: isSelected ? 'action.selected' : 'transparent',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            py: 1.5,
            px: 2
          }}>

                                    <ListItemAvatar>
                                        <Badge badgeContent={conv.unread_count} color="success" overlap="circular">

                                            <Avatar sx={{
                  bgcolor: 'primary.main',
                  width: 48,
                  height: 48
                }}>
                                                {conv.profile_picture_url ? <img src={conv.profile_picture_url} alt="" style={{
                    width: '100%',
                    height: '100%'
                  }} /> : (getDisplayName(conv) || '?')[0].toUpperCase()}
                                            </Avatar>
                                        </Badge>
                                    </ListItemAvatar>
                                    <ListItemText primary={<Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              mb: 0.3,
              minWidth: 0
            }}>
                                                <Typography variant="subtitle1" sx={{
                flex: 1,
                minWidth: 0,
                fontWeight: conv.unread_count ? 700 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.95rem'
              }}>
                                                    {getDisplayName(conv)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{
                whiteSpace: 'nowrap',
                ml: 1,
                flexShrink: 0
              }}>
                                                    {formatDate(conv.last_interaction)}
                                                </Typography>
                                            </Box>} sx={{
              minWidth: 0
            }} secondary={<Box sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
                                                <Typography variant="body2" color="text.secondary" noWrap sx={{
                maxWidth: '75%'
              }}>
                                                    {messagePreview.substring(0, 40)}
                                                </Typography>
                                                {conv.tenant_name && <Box component="span" sx={{
                bgcolor: 'primary.light',
                color: 'primary.contrastText',
                px: 0.5,
                borderRadius: 0.5,
                fontSize: '0.65rem',
                opacity: 0.8
              }}>
                                                        {conv.tenant_name}
                                                    </Box>}
                                            </Box>} />

                                </ListItem>;
        })}
                    </List>}
            </Box>

            {/* New Chat Dialog */}
            <Dialog open={showNewChatDialog} onClose={() => setShowNewChatDialog(false)} maxWidth="xs" fullWidth>

                <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>{tx("auto.k_015d3289457b")}

          <IconButton onClick={() => setShowNewChatDialog(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{
          mb: 2
        }}>{tx("auto.k_82c4de948202")}

          </Typography>
                    <TextField autoFocus fullWidth label={tx("auto.k_211cce4ca4ef")} placeholder="966501234567" value={newChatPhone} onChange={e => setNewChatPhone(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter') handleStartNewChat();
        }} dir="ltr" sx={{
          '& input': {
            textAlign: 'left',
            direction: 'ltr'
          }
        }} />

                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowNewChatDialog(false)}>{tx("auto.k_e776b0209b50")}</Button>
                    <Button variant="contained" onClick={handleStartNewChat} disabled={!newChatPhone.trim()}>{tx("auto.k_e5bde6d28c09")}


          </Button>
                </DialogActions>
            </Dialog>
        </Box>;
};
export default ChatSidebar;
