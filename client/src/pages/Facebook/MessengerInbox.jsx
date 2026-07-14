import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Paper, Typography, Button, TextField, Avatar, IconButton, CircularProgress, Alert, Snackbar, Chip, Divider, useMediaQuery, useTheme, InputAdornment, Stack } from '@mui/material';
import { Facebook as FacebookIcon, Send as SendIcon, Search as SearchIcon, Refresh as RefreshIcon, QuestionAnswer as MessengerIcon, Sync as SyncIcon, ArrowBack as ArrowBackIcon, SmartToy as BotIcon } from '@mui/icons-material';
import api from '../../api';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
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
  const [botSession, setBotSession] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success'
  });
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
  }, [selectedPageId]);
  useEffect(() => {
    loadAllPages();
  }, [loadAllPages]);
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
  const loadBotSession = useCallback(async (conv = selectedConv) => {
    if (!conv?.tenant_id || !conv?.id) {
      setBotSession(null);
      return null;
    }
    try {
      const sessions = await api.getMessengerBotSessions(conv.tenant_id, {
        conversation_id: conv.id
      });
      const session = Array.isArray(sessions) ? sessions[0] || null : null;
      setBotSession(session);
      return session;
    } catch {
      setBotSession(null);
      return null;
    }
  }, [selectedConv]);
  useEffect(() => {
    if (selectedConv) {
      loadMessages();
      loadBotSession(selectedConv);
    }
  }, [selectedConv, loadMessages, loadBotSession]);
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth'
      });
    }
  }, [messages]);
  const handleSelectConv = async conv => {
    setSelectedConv(conv);
    if (conv.unread_count > 0 && selectedPageId) {
      try {
        await api.markMessengerRead(selectedPageId, conv.id);
        setConversations(prev => prev.map(c => c.id === conv.id ? {
          ...c,
          unread_count: 0
        } : c));
      } catch {/* best effort */}
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
      setSnackbar({
        open: true,
        message: tx("auto.k_1b3fe40e01e2"),
        severity: 'success'
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_65e189d7845d"),
        severity: 'error'
      });
    } finally {
      setSendingReply(false);
    }
  };
  const handleSync = async () => {
    if (!selectedPageId) return;
    try {
      setSyncing(true);
      const result = await api.syncMessengerConversations(selectedPageId);
      setSnackbar({
        open: true,
        message: tx("auto.k_afa4b49d7c2a", {
          value1: result.synced_conversations || 0,
          value2: result.synced_messages || 0
        }),
        severity: 'success'
      });
      await loadConversations();
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_204e2a8c543a"),
        severity: 'error'
      });
    } finally {
      setSyncing(false);
    }
  };
  const handleBotStatusChange = async () => {
    if (!botSession?.id || !selectedConv?.tenant_id) {
      setSnackbar({
        open: true,
        message: tx("auto.k_4dcf46674551"),
        severity: 'warning'
      });
      return;
    }
    const nextStatus = botSession.status === 'handoff' ? 'active' : 'handoff';
    try {
      await api.updateMessengerBotSession(selectedConv.tenant_id, botSession.id, nextStatus);
      await loadBotSession(selectedConv);
      setSnackbar({
        open: true,
        message: nextStatus === 'handoff' ? tx("auto.k_26a405862093") : tx("auto.k_32b0fe075c3c"),
        severity: 'success'
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: err.message || tx("auto.k_5424ddd12119"),
        severity: 'error'
      });
    }
  };

  // SSE listener
  useEffect(() => {
    let evtSource = null;
    let reconnectTimeout = null;
    const connectSSE = async () => {
      try {
        const sseUrl = await api.getSseUrl('/api/messages/events');
        evtSource = new EventSource(sseUrl);
        evtSource.addEventListener('fb_message:new', e => {
          try {
            const data = JSON.parse(e.data);
            loadConversations();
            const current = selectedConvRef.current;
            if (current && data.conversation_id === current.id) {
              loadMessages();
            }
          } catch {/* ignore */}
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
  const formatTime = ts => {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      const now = new Date();
      const diff = now - date;
      if (diff < 86400000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString(getCurrentLocale(), {
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      if (diff < 172800000) return tx("auto.k_3957c8cfd041");
      return date.toLocaleDateString(getCurrentLocale(), {
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return ts;
    }
  };
  const formatMessageTime = ts => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString(getCurrentLocale(), {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };
  const getDateKey = ts => {
    if (!ts) return 'unknown';
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  if (pagesLoading) {
    return <Box sx={{
      display: 'flex',
      justifyContent: 'center',
      p: 6
    }}><CircularProgress /></Box>;
  }
  return <Box sx={{
    height: {
      xs: 'calc(100vh - 48px)',
      md: '100vh'
    },
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }}>
            {/* Page selector header */}
            <Paper sx={{
      p: 1.5,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
      borderBottom: 1,
      borderColor: 'divider'
    }}>
                <MessengerIcon sx={{
        color: '#0084ff',
        fontSize: 28
      }} />
                <Box sx={{
        flex: 1,
        minWidth: 0
      }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>{tx("auto.k_a7f333a94865")}</Typography>
                </Box>
                <Box sx={{
        minWidth: 200
      }}>
                    <TextField select size="small" fullWidth value={selectedPageId} onChange={e => {
          setSelectedPageId(e.target.value);
          setSelectedConv(null);
        }} variant="outlined">

                        {allPages.map(page => <option key={page.id} value={page.id}>{page.page_name || page.page_id}</option>)}
                    </TextField>
                </Box>
                {selectedPageId && <Button size="small" startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />} onClick={handleSync} disabled={syncing}>{tx("auto.k_5ad06a96052f")}

        </Button>}
            </Paper>

            <Box sx={{
      flex: 1,
      display: 'flex',
      overflow: 'hidden'
    }}>
                {/* Sidebar - Conversation List */}
                {(!isMobile || !selectedConv) && <Box sx={{
        width: {
          xs: '100%',
          md: 350,
          lg: 400
        },
        borderRight: {
          md: 1
        },
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
                        <Box sx={{
          p: 1.5
        }}>
                            <TextField fullWidth size="small" placeholder={tx("auto.k_9d960051c8e0")} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
          }} />

                        </Box>

                        {conversationsLoading ? <Box sx={{
          display: 'flex',
          justifyContent: 'center',
          p: 4
        }}><CircularProgress size={24} /></Box> : filteredConversations.length === 0 ? <Box sx={{
          p: 4,
          textAlign: 'center'
        }}>
                                <MessengerIcon sx={{
            fontSize: 48,
            color: '#0084ff',
            opacity: 0.3,
            mb: 1
          }} />
                                <Typography color="text.secondary">{tx("auto.k_76172e0ff683")}</Typography>
                                {selectedPageId && <Button size="small" startIcon={<SyncIcon />} onClick={handleSync} sx={{
            mt: 1
          }}>{tx("auto.k_3616c3b068a9")}</Button>}
                            </Box> : <Box sx={{
          flex: 1,
          overflowY: 'auto'
        }}>
                                {filteredConversations.map(conv => <Box key={conv.id} onClick={() => handleSelectConv(conv)} sx={{
            p: 1.5,
            px: 2,
            cursor: 'pointer',
            bgcolor: selectedConv?.id === conv.id ? 'action.selected' : 'transparent',
            '&:hover': {
              bgcolor: 'action.hover'
            },
            borderBottom: 1,
            borderColor: 'divider'
          }}>

                                        <Box sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5
            }}>
                                            <Avatar src={conv.user_profile_pic} sx={{
                width: 48,
                height: 48,
                bgcolor: '#0084ff'
              }}>
                                                {conv.user_name?.charAt(0) || '?'}
                                            </Avatar>
                                            <Box sx={{
                flex: 1,
                minWidth: 0
              }}>
                                                <Box sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                                                    <Typography variant="subtitle2" fontWeight={conv.unread_count > 0 ? 700 : 400} noWrap>
                                                        {conv.user_name || conv.user_psid}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{
                    flexShrink: 0,
                    ml: 1
                  }}>
                                                        {formatTime(conv.last_message_time)}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mt: 0.5
                }}>
                                                    <Typography variant="body2" color="text.secondary" noWrap sx={{
                    flex: 1
                  }}>
                                                        {conv.last_message || '—'}
                                                    </Typography>
                                                    {conv.unread_count > 0 && <Chip label={conv.unread_count} size="small" color="primary" sx={{
                    height: 20,
                    minWidth: 20,
                    ml: 1
                  }} />}
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>)}
                            </Box>}
                    </Box>}

                {/* Chat Window */}
                {(!isMobile || selectedConv) && <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
                        {!selectedConv ? <Box sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#f0f2f5',
          borderBottom: 4,
          borderColor: '#0084ff'
        }}>
                                <MessengerIcon sx={{
            fontSize: 64,
            color: '#0084ff',
            opacity: 0.3,
            mb: 2
          }} />
                                <Typography variant="h6" color="text.secondary">{tx("auto.k_7190ba70ad33")}</Typography>
                            </Box> : <>
                                {/* Chat header */}
                                <Box sx={{
            p: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper'
          }}>
                                    {isMobile && <IconButton aria-label="Back to conversations" onClick={() => setSelectedConv(null)}><ArrowBackIcon /></IconButton>}
                                    <Avatar src={selectedConv.user_profile_pic} sx={{
              bgcolor: '#0084ff'
            }}>
                                        {selectedConv.user_name?.charAt(0) || '?'}
                                    </Avatar>
                                    <Box sx={{
              flex: 1
            }}>
                                        <Typography variant="subtitle1" fontWeight={600}>{selectedConv.user_name || selectedConv.user_psid}</Typography>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="caption" color="text.secondary">{tx("auto.k_a47d791b9698")}{selectedPage?.page_name || selectedConv.page_id}</Typography>
                                            <Chip size="small" icon={<BotIcon sx={{
                  fontSize: 14
                }} />} label={botSession?.status === 'handoff' ? tx("auto.k_970408e34532") : botSession?.status === 'closed' ? tx("auto.k_77970319d6a4") : 'Bot active'} color={botSession?.status === 'handoff' ? 'warning' : botSession?.status === 'closed' ? 'default' : 'success'} variant="outlined" sx={{
                  height: 20,
                  fontSize: 11
                }} />

                                        </Stack>
                                    </Box>
                                    <Button size="small" variant="outlined" startIcon={<BotIcon />} onClick={handleBotStatusChange}>
                                        {botSession?.status === 'handoff' ? tx("auto.k_831062aca5c7") : tx("auto.k_ab2f060b4db6")}
                                    </Button>
                                    <IconButton aria-label={tx("auto.k_4309a75e6882")} onClick={() => {
              loadMessages();
              loadConversations();
            }}><RefreshIcon /></IconButton>
                                </Box>

                                {/* Messages area */}
                                <Box sx={{
            flex: 1,
            overflowY: 'auto',
            p: 2,
            bgcolor: '#f0f2f5'
          }}>
                                    {messagesLoading ? <Box sx={{
              display: 'flex',
              justifyContent: 'center',
              p: 4
            }}><CircularProgress /></Box> : messages.length === 0 ? <Box sx={{
              textAlign: 'center',
              py: 4
            }}>
                                            <Typography color="text.secondary">{tx("auto.k_087d300e4eb7")}</Typography>
                                        </Box> : (() => {
              let lastDateKey = '';
              return messages.map((msg, idx) => {
                const isOutgoing = msg.direction === 'outgoing';
                const dateKey = getDateKey(msg.created_at);
                const showDateSep = dateKey !== lastDateKey;
                lastDateKey = dateKey;
                return <React.Fragment key={msg.id || idx}>
                                                        {showDateSep && <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    my: 2
                  }}>
                                                                <Chip label={msg.created_at ? new Date(msg.created_at).toLocaleDateString(getCurrentLocale(), {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : ''} size="small" sx={{
                      bgcolor: 'background.paper'
                    }} />
                                                            </Box>}
                                                        <Box sx={{
                    display: 'flex',
                    justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
                    mb: 1,
                    px: {
                      xs: 0.5,
                      md: 2
                    }
                  }}>
                                                            <Paper elevation={1} sx={{
                      p: '6px 12px',
                      maxWidth: {
                        xs: '85%',
                        md: '65%'
                      },
                      bgcolor: isOutgoing ? '#0084ff' : '#ffffff',
                      color: isOutgoing ? '#fff' : 'text.primary',
                      borderRadius: 2,
                      borderTopRightRadius: isOutgoing ? 0 : 2,
                      borderTopLeftRadius: !isOutgoing ? 0 : 2,
                      wordBreak: 'break-word'
                    }}>
                                                                {!isOutgoing && msg.sender_name && <Typography variant="caption" fontWeight={600} sx={{
                        display: 'block',
                        mb: 0.5,
                        color: '#0084ff'
                      }}>
                                                                        {msg.sender_name}
                                                                    </Typography>}
                                                                {msg.message_text && <Typography variant="body2">{msg.message_text}</Typography>}
                                                                {msg.attachment_url && <Box sx={{
                        mt: 1
                      }}>
                                                                        {msg.attachment_type === 'image' ? <Box component="img" src={msg.attachment_url} sx={{
                          maxWidth: '100%',
                          borderRadius: 1
                        }} /> : <Typography variant="body2" component="a" href={msg.attachment_url} target="_blank" rel="noopener" sx={{
                          wordBreak: 'break-all'
                        }}>
                                                                                📎 {msg.attachment_type || tx("auto.k_052eabac3913")}
                                                                            </Typography>}
                                                                    </Box>}
                                                                {msg.sticker_url && <Box component="img" src={msg.sticker_url} sx={{
                        maxWidth: 150
                      }} />}
                                                                <Typography variant="caption" sx={{
                        display: 'block',
                        mt: 0.5,
                        textAlign: 'left',
                        opacity: 0.7,
                        fontSize: '0.65rem'
                      }}>
                                                                    {formatMessageTime(msg.created_at)}
                                                                </Typography>
                                                            </Paper>
                                                        </Box>
                                                    </React.Fragment>;
              });
            })()}
                                    <div ref={messagesEndRef} />
                                </Box>

                                {/* Reply input */}
                                <Box sx={{
            p: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            gap: 1
          }}>
                                    <TextField fullWidth size="small" placeholder={tx("auto.k_8229666e5b3c")} value={replyText} onChange={e => setReplyText(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendReply();
              }
            }} disabled={sendingReply} multiline maxRows={3} />

                                    <IconButton color="primary" aria-label="Send reply" onClick={handleSendReply} disabled={sendingReply || !replyText.trim()} sx={{
              bgcolor: '#0084ff',
              color: 'white',
              '&:hover': {
                bgcolor: '#0066cc'
              },
              '&.Mui-disabled': {
                bgcolor: 'action.disabledBackground',
                color: 'action.disabled'
              }
            }}>

                                        {sendingReply ? <CircularProgress size={20} sx={{
                color: 'white'
              }} /> : <SendIcon />}
                                    </IconButton>
                                </Box>
                            </>}
                    </Box>}
            </Box>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({
      ...prev,
      open: false
    }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({
        ...prev,
        open: false
      }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>;
};
export default MessengerInbox;
