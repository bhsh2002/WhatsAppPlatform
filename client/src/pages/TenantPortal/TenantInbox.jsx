import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { DoneAll as DoneAllIcon, Done as DoneIcon, Schedule as ScheduleIcon, Error as ErrorIcon } from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import UnifiedSidebar from '../../components/Inbox/UnifiedSidebar';
import UnifiedChatWindow from '../../components/Inbox/UnifiedChatWindow';
import ChatWindow from '../../components/WhatsApp/ChatWindow';
import { getUnifiedConversationKey, isSameUnifiedConversation } from '../../utils/conversationKeys';
import { isNearBottom, scrollElementToBottom } from '../../utils/chatScroll';
import { tx } from "../../i18n/tx";
import { getCurrentLocale } from "../../utils/locale";
import { PageTitle } from '../../components/Layout/PageTitle';
import IntegrationRequestBar from '../../components/Inbox/IntegrationRequestBar';
const TenantInbox = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [searchParams, setSearchParams] = useSearchParams();
  const initialChannel = ['whatsapp', 'messenger', 'sms'].includes(searchParams.get('channel')) ? searchParams.get('channel') : '';
  const [conversations, setConversations] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingDoc, setSendingDoc] = useState(false);
  const [sendingInteractive, setSendingInteractive] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [channelFilter, setChannelFilter] = useState(initialChannel);
  const [templates, setTemplates] = useState([]);
  const [windowStatus, setWindowStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [utilityFallback, setUtilityFallback] = useState(null);
  const [botSession, setBotSession] = useState(null);
  const [integrationRequests, setIntegrationRequests] = useState([]);
  const [activeIntegrationRequest, setActiveIntegrationRequest] = useState(null);
  const [integrationRequestBusyId, setIntegrationRequestBusyId] = useState(null);
  const [platformIntegrations, setPlatformIntegrations] = useState([]);
  const [integrationProducts, setIntegrationProducts] = useState([]);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const selectedChatRef = useRef(null);
  const isFirstLoad = useRef(true);
  const shouldStickToBottomRef = useRef(true);
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  // ============================================
  // Data Fetching (Portal-scoped)
  // ============================================

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (channelFilter) params.channel = channelFilter;
      const data = await api.getPortalUnifiedConversations(params);
      setConversations(data);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [channelFilter]);
  useEffect(() => {
    fetchConversations();
    api.getMediaToken();
  }, [fetchConversations]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getPortalPlatformIntegrations(),
      api.getPortalIntegrationProducts(100),
    ]).then(([integrationResponse, productResponse]) => {
      if (cancelled) return;
      setPlatformIntegrations(integrationResponse?.data || integrationResponse || []);
      setIntegrationProducts(productResponse?.data || productResponse || []);
    }).catch(error => {
      if (!cancelled) {
        console.error('Failed to load contextual integration products:', error);
        setPlatformIntegrations([]);
        setIntegrationProducts([]);
      }
    });
    return () => { cancelled = true; };
  }, []);
  const productCapability = useMemo(() => {
    const connected = platformIntegrations.filter(item => item.connection_id);
    const active = connected.filter(item => item.status === 'active');
    const entitled = active.filter(item => item.entitled);
    const providers = entitled.filter(item => {
      const scopes = new Set(item.scopes || []);
      if (item.platform_code === 'pos') {
        return scopes.has('savana.products.sync') || scopes.has('pos.products.map');
      }
      if (item.platform_code === 'catalog') {
        return scopes.has('wa_savana.products.receive') || scopes.has('catalog.products.projection');
      }
      return item.platform_code === 'sawemly'
        && (scopes.has('wa_savana.products.receive') || scopes.has('sawemly.availability.events'));
    });
    if (providers.length) {
      return {
        enabled: true,
        providers: providers.map(item => item.platform_code),
        reason: 'إدراج منتج متزامن في الرسالة',
      };
    }
    if (!connected.length) {
      return { enabled: false, providers: [], reason: 'اربط POS أو Catalog أو Sawemly لاستخدام المنتجات في المحادثة.' };
    }
    if (!active.length) {
      return { enabled: false, providers: [], reason: 'ربط المنتجات موجود لكنه غير نشط. استأنف الربط أولاً.' };
    }
    if (!entitled.length) {
      return { enabled: false, providers: [], reason: 'هذه الميزة غير مشمولة في الاشتراك الحالي للربط.' };
    }
    return { enabled: false, providers: [], reason: 'الربط لا يملك صلاحية مشاركة المنتجات مع Wa.' };
  }, [platformIntegrations]);
  const fetchIntegrationRequests = useCallback(async () => {
    try {
      const response = await api.getPortalMessageRequests(20);
      setIntegrationRequests(response?.data || []);
    } catch (error) {
      if (![404, 503].includes(error?.status)) {
        console.error('Failed to fetch cross-platform message requests:', error);
      }
      setIntegrationRequests([]);
    }
  }, []);
  useEffect(() => {
    fetchIntegrationRequests();
    const interval = setInterval(fetchIntegrationRequests, 15000);
    return () => clearInterval(interval);
  }, [fetchIntegrationRequests]);
  useEffect(() => {
    const channel = searchParams.get('channel');
    if (['whatsapp', 'messenger', 'sms'].includes(channel) && channelFilter !== channel) {
      setChannelFilter(channel);
    }
  }, [channelFilter, searchParams]);
  const fetchMessages = useCallback(async conv => {
    const requestedKey = getUnifiedConversationKey(conv);
    try {
      if (isFirstLoad.current) setLoadingMessages(true);
      const params = {};
      if (conv.channel === 'messenger') {
        params.conversation_id = conv.conversation_id;
      } else if (conv.channel === 'sms') {
        params.sms_account_id = conv.sms_account_id;
      }
      const data = await api.getPortalUnifiedMessages(conv.channel, conv.contact_id, params);
      if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
        shouldStickToBottomRef.current = isFirstLoad.current || isNearBottom(messagesContainerRef.current);
        setMessages(data);
      }
      return data || [];
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
        setMessages([]);
      }
      return [];
    } finally {
      if (getUnifiedConversationKey(selectedChatRef.current) === requestedKey) {
        setLoadingMessages(false);
      }
    }
  }, []);
  const fetchTemplates = useCallback(async () => {
    try {
      const data = await api.getPortalTemplates();
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      setTemplates([]);
    }
  }, []);
  const fetchWindowStatus = useCallback(async contactId => {
    if (!contactId) {
      setWindowStatus(null);
      return;
    }
    try {
      const data = await api.getWindowStatus(contactId);
      setWindowStatus(data);
    } catch {
      setWindowStatus(null);
    }
  }, []);
  const fetchBotSession = useCallback(async conv => {
    if (!conv || conv.channel !== 'messenger' || !conv.conversation_id) {
      setBotSession(null);
      return null;
    }
    try {
      const sessions = await api.getPortalMessengerBotSessions({
        conversation_id: conv.conversation_id
      });
      const session = Array.isArray(sessions) ? sessions[0] || null : null;
      setBotSession(session);
      return session;
    } catch {
      setBotSession(null);
      return null;
    }
  }, []);
  const markAsRead = useCallback(async (msgs, conv) => {
    try {
      if (conv.channel === 'whatsapp') {
        const lastIncoming = msgs.filter(m => m.direction === 'incoming').pop();
        if (lastIncoming?.wamid) {
          await api.markAsReadPortal({
            message_id: lastIncoming.wamid
          });
        }
      }
      // Messenger mark-as-read is handled by the messages endpoint
    } catch {

      // Best-effort
    }
  }, []);
  // ============================================
  // Chat Selection & Auto-refresh
  // ============================================

  useEffect(() => {
    if (selectedChat) {
      isFirstLoad.current = true;
      fetchMessages(selectedChat).then(loadedMessages => {
        if (!isSameUnifiedConversation(selectedChatRef.current, selectedChat)) return;
        markAsRead(loadedMessages, selectedChat);
        setConversations(prev => prev.map(conv => isSameUnifiedConversation(conv, selectedChat) ? {
          ...conv,
          unread_count: 0
        } : conv));
      });
      if (selectedChat.channel === 'whatsapp') {
        fetchTemplates();
        fetchWindowStatus(selectedChat.contact_id);
        setBotSession(null);
      } else {
        setTemplates([]);
        setWindowStatus(null);
        fetchBotSession(selectedChat);
      }
      const interval = setInterval(() => fetchMessages(selectedChat), 15000);
      return () => clearInterval(interval);
    } else {
      setWindowStatus(null);
      setBotSession(null);
    }
  }, [selectedChat, fetchMessages, fetchTemplates, fetchWindowStatus, fetchBotSession, markAsRead]);
  const clearContactQuery = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    ['contact', 'name', 'tenant_id'].forEach(key => {
      if (nextParams.has(key)) {
        nextParams.delete(key);
        changed = true;
      }
    });
    if (changed) {
      setSearchParams(nextParams, {
        replace: true
      });
    }
  }, [searchParams, setSearchParams]);
  const handleSelectChat = useCallback((conv, options = {}) => {
    isFirstLoad.current = true;
    setMessages([]);
    setSelectedChat(conv);
    setNewMessage('');
    setUtilityFallback(null);
    if (!options.fromQuery) {
      clearContactQuery();
    }
  }, [clearContactQuery]);
  const messageFromIntegrationRequest = useCallback(request => {
    const payload = request?.payload || {};
    if (payload.message) return payload.message;
    const parameters = payload.parameters || {};
    if (parameters.order_number) {
      return `مرحباً ${parameters.customer_name || 'بك'}، تحديث الطلب #${parameters.order_number}: ${parameters.status || 'تم تحديث حالته'}.`;
    }
    return '';
  }, []);
  const handleOpenIntegrationRequest = useCallback(async request => {
    const phone = request?.payload?.recipient?.phone_e164?.replace(/\D/g, '');
    if (!phone) return;
    try {
      setIntegrationRequestBusyId(request.id);
      const response = await api.acceptPortalMessageRequest(request.id);
      const approvedRequest = response?.request || { ...request, status: 'approved' };
      const nextChat = conversations.find(conv => (
        conv.channel === 'whatsapp' && String(conv.contact_id) === phone
      )) || {
        channel: 'whatsapp',
        contact_id: phone,
        display_name: request?.payload?.parameters?.customer_name || phone,
        avatar_url: null,
      };
      handleSelectChat(nextChat, { fromQuery: true });
      setNewMessage(messageFromIntegrationRequest(approvedRequest));
      setActiveIntegrationRequest(approvedRequest);
      await fetchIntegrationRequests();
    } catch (error) {
      console.error('Failed to open cross-platform message request:', error);
    } finally {
      setIntegrationRequestBusyId(null);
    }
  }, [conversations, fetchIntegrationRequests, handleSelectChat, messageFromIntegrationRequest]);
  const handleDismissIntegrationRequest = useCallback(async request => {
    try {
      setIntegrationRequestBusyId(request.id);
      await api.dismissPortalMessageRequest(request.id);
      if (activeIntegrationRequest?.id === request.id) setActiveIntegrationRequest(null);
      await fetchIntegrationRequests();
    } catch (error) {
      console.error('Failed to dismiss cross-platform message request:', error);
    } finally {
      setIntegrationRequestBusyId(null);
    }
  }, [activeIntegrationRequest, fetchIntegrationRequests]);
  const completeActiveIntegrationRequest = useCallback(async channelMessageId => {
    if (!activeIntegrationRequest) return;
    const completedId = activeIntegrationRequest.id;
    setActiveIntegrationRequest(null);
    try {
      await api.completePortalMessageRequest(completedId, channelMessageId || null);
      await fetchIntegrationRequests();
    } catch (error) {
      console.error('Message sent but cross-platform status could not be updated:', error);
      setActiveIntegrationRequest(activeIntegrationRequest);
    }
  }, [activeIntegrationRequest, fetchIntegrationRequests]);
  useEffect(() => {
    const requestedChannel = searchParams.get('channel') || 'whatsapp';
    const requestedContact = searchParams.get('contact');
    if (requestedChannel !== 'whatsapp' || !requestedContact || loading) return;
    const normalizedContact = requestedContact.replace(/\+/g, '').trim();
    const found = conversations.find(conv => conv.channel === 'whatsapp' && String(conv.contact_id) === normalizedContact);
    const nextChat = found || {
      channel: 'whatsapp',
      contact_id: normalizedContact,
      display_name: searchParams.get('name') || normalizedContact,
      avatar_url: null,
      last_ctwa_clid: null,
      last_ctwa_source_id: null,
      last_ctwa_source_type: null,
      last_ctwa_source_url: null,
      last_ctwa_received_at: null
    };
    if (!isSameUnifiedConversation(selectedChatRef.current, nextChat)) {
      handleSelectChat(nextChat, {
        fromQuery: true
      });
    }
    clearContactQuery();
  }, [clearContactQuery, conversations, handleSelectChat, loading, searchParams]);

  // Smart scroll
  useEffect(() => {
    if (messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    if (isFirstLoad.current) {
      scrollElementToBottom(container);
      isFirstLoad.current = false;
      return;
    }
    if (shouldStickToBottomRef.current) {
      scrollElementToBottom(container, 'smooth');
    }
  }, [messages]);
  const scrollToBottom = () => {
    setTimeout(() => {
      scrollElementToBottom(messagesContainerRef.current);
    }, 50);
  };

  // ============================================
  // WhatsApp Send Handlers (Portal API)
  // ============================================

  const handleSendWAMessage = useCallback(async () => {
    if (!newMessage.trim() || !selectedChat || sending) return;
    try {
      setSending(true);
      const result = await api.sendPortalMessage({
        recipient: selectedChat.contact_id,
        type: 'text',
        message: newMessage.trim()
      });
      await completeActiveIntegrationRequest(result?.message_id);
      setNewMessage('');
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setSending(false);
    }
  }, [newMessage, selectedChat, sending, fetchMessages, fetchConversations, completeActiveIntegrationRequest]);
  const handleSendTemplate = useCallback(async templateData => {
    if (!selectedChat || sending) return;
    try {
      setSending(true);
      const result = await api.sendPortalMessage({
        recipient: selectedChat.contact_id,
        type: 'template',
        templateId: templateData.id,
        components: templateData.components
      });
      await completeActiveIntegrationRequest(result?.message_id);
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send template:', err);
      alert(tx("auto.k_ed3ba0d83bee"));
    } finally {
      setSending(false);
    }
  }, [selectedChat, sending, fetchMessages, fetchConversations, completeActiveIntegrationRequest]);
  const handleSendDocument = useCallback(async (file, caption) => {
    if (!file || !selectedChat) return;
    try {
      setSendingDoc(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recipient', selectedChat.contact_id);
      formData.append('filename', file.name);
      if (caption) formData.append('caption', caption);
      await api.sendPortalDocument(formData);
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send document:', err);
      alert(tx("auto.k_05a0e956033a") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingDoc(false);
    }
  }, [selectedChat, fetchMessages, fetchConversations]);
  const handleSendImage = useCallback(async (file, caption) => {
    if (!file || !selectedChat) return;
    try {
      setSendingDoc(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('recipient', selectedChat.contact_id);
      if (caption) formData.append('caption', caption);
      await api.sendPortalImage(formData);
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send image:', err);
      alert(tx("auto.k_a8b07570e41f") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingDoc(false);
    }
  }, [selectedChat, fetchMessages, fetchConversations]);
  const handleSendInteractive = useCallback(async data => {
    if (!selectedChat) return;
    try {
      setSendingInteractive(true);
      await api.sendPortalInteractiveMessage({
        recipient: selectedChat.contact_id,
        ...data
      });
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send interactive:', err);
      alert(tx("auto.k_47104fbad60f") + (err.message || tx("auto.k_7767dead5829")));
    } finally {
      setSendingInteractive(false);
    }
  }, [selectedChat, fetchMessages, fetchConversations]);

  // ============================================
  // Messenger Send Handler (Portal unified)
  // ============================================

  const handleSendMessengerMessage = useCallback(async text => {
    if (!text?.trim() || !selectedChat) return;
    try {
      setSending(true);
      await api.sendPortalUnifiedMessage('messenger', selectedChat.contact_id, {
        message: text.trim(),
        linked_page_id: selectedChat.linked_page_id
      });
      setNewMessage('');
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      const errMsg = err.message || '';
      if (errMsg.includes('24') || errMsg.includes('window') || errMsg.includes('outside')) {
        setUtilityFallback({
          text: text.trim(),
          timestamp: Date.now()
        });
      }
      console.error('Failed to send:', err);
    } finally {
      setSending(false);
    }
  }, [selectedChat, fetchMessages, fetchConversations]);

  const handleSendSmsMessage = useCallback(async text => {
    if (!text?.trim() || !selectedChat?.sms_account_id) return;
    try {
      setSending(true);
      await api.sendPortalUnifiedMessage('sms', selectedChat.contact_id, {
        message: text.trim(),
        sms_account_id: selectedChat.sms_account_id,
        idempotency_key: `wa-ui:${crypto.randomUUID()}`
      });
      setNewMessage('');
      await fetchMessages(selectedChat);
      fetchConversations();
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send SMS:', err);
    } finally {
      setSending(false);
    }
  }, [selectedChat, fetchMessages, fetchConversations]);
  const handleGetMessageTags = useCallback(async () => {
    return await api.getPortalMessageTags();
  }, []);
  const handleSendUtilityMessage = useCallback(async (message, tag) => {
    if (!selectedChat?.linked_page_id || !selectedChat?.conversation_id) {
      throw new Error(tx("auto.k_5ad2e734f6c8"));
    }
    await api.sendPortalUtilityMessage(selectedChat.linked_page_id, selectedChat.conversation_id, {
      message,
      tag
    });
    await fetchMessages(selectedChat);
    fetchConversations();
  }, [selectedChat, fetchMessages, fetchConversations]);
  const handleBotStatusChange = useCallback(async status => {
    if (!botSession?.id) {
      alert(tx("auto.k_b8425ec2bb85"));
      return;
    }
    await api.updatePortalMessengerBotSession(botSession.id, status);
    await fetchBotSession(selectedChat);
  }, [botSession, fetchBotSession, selectedChat]);

  // ============================================
  // SSE Integration (Portal endpoint)
    // ============================================

  useEffect(() => {
    let evtSource = null;
    let reconnectTimeout = null;
    const connectSSE = async () => {
      try {
        const sseUrl = await api.getSseUrl('/api/portal/events');
        evtSource = new EventSource(sseUrl);
        evtSource.addEventListener('message:new', e => {
          fetchConversations();
          const current = selectedChatRef.current;
          if (current && current.channel === 'whatsapp') {
            const data = JSON.parse(e.data);
            if (data.sender === current.contact_id || data.recipient === current.contact_id) {
              fetchMessages(current);
            }
          }
        });
        evtSource.addEventListener('message:status', e => {
          const data = JSON.parse(e.data);
          setMessages(prev => prev.map(msg => msg.wamid === data.wamid ? {
            ...msg,
            status: data.status
          } : msg));
        });
        evtSource.addEventListener('fb_message:new', e => {
          fetchConversations();
          const current = selectedChatRef.current;
          if (current && current.channel === 'messenger') {
            const data = JSON.parse(e.data);
            if (data.conversation_id === current.conversation_id) {
              fetchMessages(current);
            }
          }
        });
        evtSource.addEventListener('sms_message:new', e => {
          fetchConversations();
          const current = selectedChatRef.current;
          if (current && current.channel === 'sms') {
            const data = JSON.parse(e.data);
            if (Number(data.sms_account_id) === Number(current.sms_account_id)
              && (data.sender === current.contact_id || data.recipient === current.contact_id)) {
              fetchMessages(current);
            }
          }
        });
        evtSource.addEventListener('sms_message:status', e => {
          const data = JSON.parse(e.data);
          setMessages(prev => prev.map(msg => (
            msg.wamid === data.gateway_message_id ? { ...msg, status: data.status } : msg
          )));
        });
        evtSource.addEventListener('conversation:update', () => {
          fetchConversations();
        });
        evtSource.onerror = () => {
          if (evtSource) evtSource.close();
          reconnectTimeout = setTimeout(connectSSE, 5000);
        };
      } catch {
        reconnectTimeout = setTimeout(connectSSE, 5000);
      }
    };
    connectSSE();
    return () => {
      if (evtSource) evtSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [fetchConversations, fetchMessages]);

  // ============================================
  // Helper functions for ChatWindow
  // ============================================

  const getDisplayName = useCallback(chat => {
    if (chat?.direction === 'outgoing') return tx("auto.k_4ab1332cb54b");
    return chat?.profile_name || chat?.sender_name || chat?.display_name || selectedChat?.display_name || chat?.sender || chat?.contact || tx("auto.k_0ded3785b2ee");
  }, [selectedChat]);
  const formatTime = useCallback(dateStr => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString(getCurrentLocale(), {
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);
  const getDateKey = useCallback(dateStr => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(getCurrentLocale());
  }, []);
  const getStatusIcon = useCallback((status, direction) => {
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
  }, []);
  const getMediaDownloadUrl = useCallback(mediaId => {
    return api.getPortalMediaDownloadUrl(mediaId);
  }, []);

  // Sync tenant's Messenger pages
  const handleSyncMessenger = useCallback(async () => {
    try {
      setSyncing(true);
      await api.syncPortalMessenger();
      await fetchConversations();
    } catch (err) {
      console.error('Messenger sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [fetchConversations]);

  // ============================================
  // Render
  // ============================================

  const chatWindowChat = selectedChat?.channel === 'whatsapp' ? {
    contact: selectedChat.contact_id,
    profile_name: selectedChat.display_name,
    profile_picture_url: selectedChat.avatar_url || null,
    last_ctwa_clid: selectedChat.last_ctwa_clid || null,
    last_ctwa_source_id: selectedChat.last_ctwa_source_id || null,
    last_ctwa_source_type: selectedChat.last_ctwa_source_type || null,
    last_ctwa_source_url: selectedChat.last_ctwa_source_url || null,
    last_ctwa_received_at: selectedChat.last_ctwa_received_at || null
  } : null;
  return <Box sx={{
    display: 'flex',
    height: {
      xs: 'calc(100vh - 56px)',
      md: '100vh'
    },
    overflow: 'hidden'
  }}>
            <PageTitle variant="h5" visuallyHidden>{tx('inbox.title')}</PageTitle>
            {/* Sidebar */}
            <Box sx={{
      width: isMobile ? selectedChat ? 0 : '100%' : 350,
      minWidth: isMobile ? 0 : 350,
      display: isMobile && selectedChat ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.3s',
      borderRight: 1,
      borderColor: 'divider'
    }}>
                <UnifiedSidebar conversations={conversations} selectedChat={selectedChat} onSelectChat={handleSelectChat} loading={loading} searchTerm={searchTerm} setSearchTerm={setSearchTerm} channelFilter={channelFilter} setChannelFilter={setChannelFilter} onRefresh={fetchConversations} onSyncMessenger={handleSyncMessenger} syncing={syncing} />

            </Box>

            {/* Chat Window */}
            <Box sx={{
      flex: 1,
      minWidth: 0,
      display: isMobile && !selectedChat ? 'none' : 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
                <IntegrationRequestBar
                  requests={integrationRequests}
                  busyId={integrationRequestBusyId}
                  onOpen={handleOpenIntegrationRequest}
                  onDismiss={handleDismissIntegrationRequest}
                />
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  {selectedChat?.channel === 'whatsapp' ? <ChatWindow selectedChat={chatWindowChat} messages={messages} loadingMessages={loadingMessages} onSendMessage={handleSendWAMessage} onSendTemplate={handleSendTemplate} onSendDocument={handleSendDocument} onSendImage={handleSendImage} onSendInteractive={handleSendInteractive} onBack={() => setSelectedChat(null)} newMessage={newMessage} setNewMessage={setNewMessage} sending={sending} sendingDoc={sendingDoc} sendingInteractive={sendingInteractive} messagesEndRef={messagesEndRef} messagesContainerRef={messagesContainerRef} getDisplayName={getDisplayName} formatTime={formatTime} getStatusIcon={getStatusIcon} getMediaDownloadUrl={getMediaDownloadUrl} getDateKey={getDateKey} templates={templates} windowStatus={windowStatus} integrationProducts={integrationProducts} productCapability={productCapability} /> : <UnifiedChatWindow selectedChat={selectedChat} messages={messages} loadingMessages={loadingMessages} onBack={() => setSelectedChat(null)} onSendMessage={selectedChat?.channel === 'sms' ? handleSendSmsMessage : handleSendMessengerMessage} canSend={selectedChat?.channel !== 'sms' || /^\+?\d{5,20}$/.test(selectedChat.contact_id || '')} newMessage={newMessage} setNewMessage={setNewMessage} sending={sending} messagesEndRef={messagesEndRef} messagesContainerRef={messagesContainerRef} getDisplayName={getDisplayName} formatTime={formatTime} onSendUtilityMessage={selectedChat?.channel === 'messenger' ? handleSendUtilityMessage : undefined} getMessageTags={selectedChat?.channel === 'messenger' ? handleGetMessageTags : undefined} utilityFallback={utilityFallback} botSession={botSession} onBotStatusChange={handleBotStatusChange} integrationProducts={integrationProducts} productCapability={productCapability} />}
                </Box>
            </Box>
        </Box>;
};
export default TenantInbox;
