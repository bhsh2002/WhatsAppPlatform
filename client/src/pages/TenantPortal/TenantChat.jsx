import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import { DoneAll as DoneAllIcon, Done as DoneIcon, Schedule as ScheduleIcon, Error as ErrorIcon } from '@mui/icons-material';
import api from '../../api';
import ChatSidebar from '../../components/WhatsApp/ChatSidebar';
import ChatWindow from '../../components/WhatsApp/ChatWindow';
import { getWhatsAppConversationKey, isSameWhatsAppConversation } from '../../utils/conversationKeys';
import { isNearBottom, scrollElementToBottom } from '../../utils/chatScroll';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
const TenantChat = () => {
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingDoc, setSendingDoc] = useState(false);
  const [sendingInteractive, setSendingInteractive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [windowStatus, setWindowStatus] = useState(null);

  // Template State
  const [templates, setTemplates] = useState([]);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isFirstLoad = useRef(true);
  const selectedChatRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);

  // Responsive
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPortalConversations();
      setConversations(data);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, []);
  const fetchTemplates = useCallback(async () => {
    try {
      const data = await api.getPortalTemplates();
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  }, []);
  const fetchWindowStatus = useCallback(async phone => {
    try {
      const data = await api.getWindowStatus(phone);
      setWindowStatus(data);
    } catch (err) {
      console.error('Failed to fetch window status:', err);
      setWindowStatus(null);
    }
  }, []);
  const markAsRead = useCallback(async msgs => {
    try {
      const lastIncoming = msgs.filter(m => m.direction === 'incoming').pop();
      if (lastIncoming?.wamid) {
        await api.markAsReadPortal({
          message_id: lastIncoming.wamid
        });
      }
    } catch {

      // Best-effort, don't block UI
    }
  }, []);
  const fetchMessages = useCallback(async phone => {
    const requestedKey = getWhatsAppConversationKey({
      contact: phone
    });
    try {
      if (isFirstLoad.current) setLoadingMessages(true);
      const data = await api.getPortalMessages(phone);
      if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
        shouldStickToBottomRef.current = isFirstLoad.current || isNearBottom(messagesContainerRef.current);
        setMessages(data);
      }
      return data || [];
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
        setMessages([]);
      }
      return [];
    } finally {
      if (getWhatsAppConversationKey(selectedChatRef.current) === requestedKey) {
        setLoadingMessages(false);
      }
    }
  }, []);

  // SSE: Real-time updates with polling fallback
  useEffect(() => {
    fetchConversations();
    fetchTemplates();
    api.getMediaToken(); // Pre-fetch media token for image/doc URLs

    let pollingInterval = null;
    let evtSource = null;
    let reconnectTimeout = null;
    let sseConnected = false;
    const startPolling = (interval = 60000) => {
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = setInterval(fetchConversations, interval);
    };
    const stopPolling = () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    };
    const connectSSE = async () => {
      try {
        const sseUrl = await api.getSseUrl('/api/portal/events');
        evtSource = new EventSource(sseUrl);
        evtSource.addEventListener('connected', () => {
          sseConnected = true;
          console.log('[SSE] Tenant connected — real-time updates active');
          stopPolling();
        });
        evtSource.addEventListener('message:new', e => {
          const data = JSON.parse(e.data);
          fetchConversations();
          const current = selectedChatRef.current;
          if (current && (data.sender === current.contact || data.recipient === current.contact)) {
            fetchMessages(current.contact);
          }
        });
        evtSource.addEventListener('message:status', e => {
          const data = JSON.parse(e.data);
          setMessages(prev => prev.map(msg => msg.wamid === data.wamid ? {
            ...msg,
            status: data.status
          } : msg));
        });
        evtSource.addEventListener('conversation:update', () => {
          fetchConversations();
        });
        evtSource.onerror = () => {
          if (sseConnected) {
            console.warn('[SSE] Connection lost — falling back to polling');
            sseConnected = false;
            startPolling(10000);
          }
          reconnectTimeout = setTimeout(connectSSE, 5000);
        };
      } catch {
        console.warn('[SSE] Failed to connect, using polling only');
        startPolling(15000);
      }
    };
    connectSSE();
    return () => {
      if (evtSource) evtSource.close();
      stopPolling();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [fetchConversations, fetchMessages, fetchTemplates]);
  useEffect(() => {
    selectedChatRef.current = selectedChat;
    if (selectedChat) {
      isFirstLoad.current = true;
      fetchMessages(selectedChat.contact).then(loadedMessages => {
        if (!isSameWhatsAppConversation(selectedChatRef.current, selectedChat)) return;
        markAsRead(loadedMessages);
        setConversations(prev => prev.map(conv => isSameWhatsAppConversation(conv, selectedChat) ? {
          ...conv,
          unread_count: 0
        } : conv));
      });
      fetchWindowStatus(selectedChat.contact);
      const interval = setInterval(() => fetchMessages(selectedChat.contact), 15000);
      return () => clearInterval(interval);
    } else {
      setWindowStatus(null);
    }
  }, [selectedChat, fetchMessages, fetchWindowStatus, markAsRead]);
  useEffect(() => {
    if (messages.length === 0) return;
    if (isFirstLoad.current) {
      scrollElementToBottom(messagesContainerRef.current);
      isFirstLoad.current = false;
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) return;
    if (shouldStickToBottomRef.current) {
      scrollElementToBottom(container, 'smooth');
    }
  }, [messages]);
  const scrollToBottom = () => {
    setTimeout(() => {
      scrollElementToBottom(messagesContainerRef.current);
    }, 50);
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
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };
  const handleSendTemplate = async templateData => {
    if (!selectedChat || sending) return;
    try {
      setSending(true);
      await api.sendPortalMessage({
        recipient: selectedChat.contact,
        type: 'template',
        templateId: templateData.id,
        components: templateData.components
      });
      await fetchMessages(selectedChat.contact);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send template:', err);
      alert(tx("auto.k_ed3ba0d83bee"));
    } finally {
      setSending(false);
    }
  };
  const handleSendDocument = async (file, caption) => {
    if (!file || !selectedChat) return;
    try {
      setSendingDoc(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recipient', selectedChat.contact);
      formData.append('filename', file.name);
      if (caption) {
        formData.append('caption', caption);
      }
      await api.sendPortalDocument(formData);
      await fetchMessages(selectedChat.contact);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send document:', err);
      alert(tx("auto.k_05a0e956033a") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingDoc(false);
    }
  };
  const handleSendImage = async (file, caption) => {
    if (!file || !selectedChat) return;
    try {
      setSendingDoc(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recipient', selectedChat.contact);
      if (caption) {
        formData.append('caption', caption);
      }
      await api.sendPortalImage(formData);
      await fetchMessages(selectedChat.contact);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send image:', err);
      alert(tx("auto.k_a8b07570e41f") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingDoc(false);
    }
  };
  const handleSendInteractive = async data => {
    if (!selectedChat) return;
    try {
      setSendingInteractive(true);
      await api.sendPortalInteractiveMessage({
        recipient: selectedChat.contact,
        ...data
      });
      await fetchMessages(selectedChat.contact);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send interactive:', err);
      alert(tx("auto.k_47104fbad60f") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingInteractive(false);
    }
  };
  const formatTime = dateStr => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(getCurrentLocale(), {
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  const formatDate = dateStr => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) {
      return tx("auto.k_b76444a321b7");
    } else if (date.toDateString() === yesterday.toDateString()) {
      return tx("auto.k_3957c8cfd041");
    }
    return date.toLocaleDateString(getCurrentLocale());
  };
  const getDateKey = dateStr => {
    return new Date(dateStr).toLocaleDateString(getCurrentLocale());
  };
  const getDisplayName = contact => {
    return contact?.profile_name || contact?.contact || tx("auto.k_0ded3785b2ee");
  };
  const getStatusIcon = (status, direction) => {
    if (direction === 'incoming') return null;
    switch (status) {
      case 'read':
        return <DoneAllIcon sx={{
          fontSize: 14,
          color: '#53bdeb'
        }} />;
      case 'delivered':
        return <DoneAllIcon sx={{
          fontSize: 14,
          color: 'text.secondary'
        }} />;
      case 'sent':
        return <DoneIcon sx={{
          fontSize: 14,
          color: 'text.secondary'
        }} />;
      case 'pending':
        return <ScheduleIcon sx={{
          fontSize: 14,
          color: 'text.secondary'
        }} />;
      case 'failed':
        return <ErrorIcon sx={{
          fontSize: 14,
          color: 'error.main'
        }} />;
      default:
        return <DoneIcon sx={{
          fontSize: 14,
          color: 'text.secondary'
        }} />;
    }
  };
  const getMediaDownloadUrl = mediaId => {
    return api.getPortalMediaDownloadUrl(mediaId);
  };
  const filteredConversations = conversations.filter(conv => (conv.profile_name || conv.contact || '').toLowerCase().includes(searchQuery.toLowerCase()));
  const handleSelectChat = chat => {
    isFirstLoad.current = true;
    setMessages([]);
    setSelectedChat(chat);
    setNewMessage('');
  };
  return <Box sx={{
    height: {
      xs: 'calc(100vh - 48px)',
      md: '100vh'
    },
    display: 'flex',
    bgcolor: 'background.default',
    overflow: 'hidden'
  }}>
            {/* Sidebar */}
            {(!isMobile || !selectedChat) && <Box sx={{
      width: {
        xs: '100%',
        md: 350
      },
      height: '100%',
      flexShrink: 0,
      minWidth: 0
    }}>
                    <ChatSidebar conversations={filteredConversations} selectedChat={selectedChat} onSelectChat={handleSelectChat} loading={loading} searchTerm={searchQuery} setSearchTerm={setSearchQuery} getDisplayName={getDisplayName} formatDate={formatDate} contactsPath="/portal/contacts" broadcastPath="/portal/broadcast" />

                </Box>}

            {/* Chat Window */}
            {(!isMobile || selectedChat) && <Box sx={{
      flex: 1,
      minWidth: 0,
      height: '100%'
    }}>
                    {selectedChat ? <ChatWindow selectedChat={selectedChat} messages={messages} loadingMessages={loadingMessages} onSendMessage={handleSendMessage} onSendTemplate={handleSendTemplate} onSendDocument={handleSendDocument} onSendImage={handleSendImage} onSendInteractive={handleSendInteractive} onBack={() => setSelectedChat(null)} newMessage={newMessage} setNewMessage={setNewMessage} sending={sending} sendingDoc={sendingDoc} sendingInteractive={sendingInteractive} messagesEndRef={messagesEndRef} messagesContainerRef={messagesContainerRef} getDisplayName={getDisplayName} formatTime={formatTime} getStatusIcon={getStatusIcon} getMediaDownloadUrl={getMediaDownloadUrl} getDateKey={getDateKey} templates={templates} windowStatus={windowStatus} /> : <Box sx={{
        flex: 1,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.secondary'
      }}>
                            <Typography variant="h6" gutterBottom>{tx("auto.k_7190ba70ad33")}</Typography>
                            <Typography variant="body2">{tx("auto.k_fd6183d88efb")}</Typography>
                        </Box>}
                </Box>}
        </Box>;
};
export default TenantChat;
