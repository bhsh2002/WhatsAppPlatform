import React from 'react';
import {
    Box,
    TextField,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Badge,
    Chip,
    Tabs,
    Tab,
    Typography,
    InputAdornment,
    IconButton,
    Tooltip,
    CircularProgress,
    Divider
} from '@mui/material';
import {
    Search as SearchIcon,
    Refresh as RefreshIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    Sync as SyncIcon
} from '@mui/icons-material';
import { getUnifiedConversationKey } from '../../utils/conversationKeys';

const getChannelColor = (channel) => {
    if (channel === 'whatsapp') return '#25D366';
    return '#0084ff';
};

const channelSections = [
    {
        value: 'whatsapp',
        title: 'WhatsApp',
        subtitle: 'محادثات واتساب للأعمال',
        icon: <WhatsAppIcon sx={{ fontSize: 18, color: '#25D366' }} />,
    },
    {
        value: 'messenger',
        title: 'Facebook',
        subtitle: 'Messenger وصفحات فيسبوك',
        icon: <FacebookIcon sx={{ fontSize: 18, color: '#1877f2' }} />,
    },
];

const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `${mins}د`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}س`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'أمس';
    if (days < 7) return `${days}أيام`;
    return d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
};

const UnifiedSidebar = ({
    conversations,
    selectedChat,
    onSelectChat,
    loading,
    searchTerm,
    setSearchTerm,
    channelFilter,
    setChannelFilter,
    onRefresh,
    onSyncMessenger,
    syncing
}) => {
    const filteredBySearch = conversations.filter(c => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            (c.display_name || c.contact_id || '').toLowerCase().includes(term) ||
            (c.contact_id || '').includes(term) ||
            (c.tenant_name || '').toLowerCase().includes(term)
        );
    });

    const filtered = channelFilter
        ? filteredBySearch.filter(c => c.channel === channelFilter)
        : filteredBySearch;

    const renderConversation = (conv) => {
        const isSelected = getUnifiedConversationKey(conv) === getUnifiedConversationKey(selectedChat);
        const displayName = conv.display_name || conv.contact_id || 'غير معروف';
        const channelColor = getChannelColor(conv.channel);
        const detailParts = [conv.tenant_name, conv.page_name].filter(Boolean);

        return (
            <ListItem
                key={getUnifiedConversationKey(conv)}
                button
                selected={isSelected}
                onClick={() => onSelectChat(conv)}
                sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    borderInlineStart: `3px solid ${channelColor}`,
                    '&.Mui-selected': {
                        bgcolor: conv.channel === 'whatsapp' ? '#25D36612' : '#1877f212',
                    },
                    '&:hover': {
                        bgcolor: conv.channel === 'whatsapp' ? '#25D3660c' : '#1877f20c',
                    },
                    px: 1.5,
                }}
            >
                <ListItemAvatar sx={{ minWidth: 48 }}>
                    <Badge
                        badgeContent={conv.unread_count || 0}
                        color="error"
                        invisible={!conv.unread_count}
                    >
                        <Avatar
                            src={conv.avatar_url || undefined}
                            sx={{ bgcolor: conv.avatar_url ? undefined : channelColor + '22', width: 40, height: 40 }}
                        >
                            {displayName.charAt(0)?.toUpperCase() || '?'}
                        </Avatar>
                    </Badge>
                </ListItemAvatar>
                <ListItemText
                    primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Typography
                                variant="body2"
                                fontWeight={conv.unread_count ? 700 : 500}
                                sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {displayName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                {formatDate(conv.last_message_time)}
                            </Typography>
                        </Box>
                    }
                    sx={{ minWidth: 0 }}
                    secondary={
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" color="text.secondary" noWrap sx={{ fontSize: 12 }}>
                                {conv.last_message || '—'}
                            </Typography>
                            {detailParts.length > 0 && (
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                    {detailParts.join(' • ')}
                                </Typography>
                            )}
                        </Box>
                    }
                />
            </ListItem>
        );
    };

    const sections = channelFilter
        ? channelSections.filter(section => section.value === channelFilter)
        : channelSections;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" fontWeight="bold">
                        📨 صندوق الوارد
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {onRefresh && (
                            <Tooltip title="تحديث">
                                <IconButton size="small" onClick={onRefresh}>
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                        {onSyncMessenger && (
                            <Tooltip title="مزامنة ماسنجر">
                                <IconButton size="small" onClick={onSyncMessenger} disabled={syncing}>
                                    {syncing ? <CircularProgress size={18} /> : <SyncIcon fontSize="small" sx={{ color: '#0084ff' }} />}
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                </Box>
                <Tabs
                    value={channelFilter || 'all'}
                    onChange={(_, value) => setChannelFilter(value === 'all' ? '' : value)}
                    variant="fullWidth"
                    sx={{
                        minHeight: 36,
                        mb: 1,
                        '& .MuiTab-root': {
                            minHeight: 36,
                            px: 1,
                            fontSize: 12,
                            fontWeight: 700,
                        },
                    }}
                >
                    <Tab value="all" label="الكل" />
                    <Tab value="whatsapp" icon={<WhatsAppIcon sx={{ fontSize: 16, color: '#25D366' }} />} iconPosition="start" label="WhatsApp" />
                    <Tab value="messenger" icon={<FacebookIcon sx={{ fontSize: 16, color: '#1877f2' }} />} iconPosition="start" label="Facebook" />
                </Tabs>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="بحث في المحادثات..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>

            <List sx={{ flex: 1, overflow: 'auto', p: 0 }}>
                {loading ? (
                    <ListItem><ListItemText primary="جاري التحميل..." sx={{ textAlign: 'center' }} /></ListItem>
                ) : filtered.length === 0 ? (
                    <ListItem><ListItemText primary="لا توجد محادثات" sx={{ textAlign: 'center', color: 'text.secondary' }} /></ListItem>
                ) : (
                    sections.map((section, sectionIndex) => {
                        const sectionConversations = filtered.filter(conv => conv.channel === section.value);
                        if (sectionConversations.length === 0) return null;

                        return (
                            <Box key={section.value}>
                                {sectionIndex > 0 && <Divider />}
                                <Box sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    px: 1.5,
                                    py: 1,
                                    bgcolor: 'background.default',
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 1,
                                }}>
                                    {section.icon}
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="subtitle2" fontWeight={800} noWrap>
                                            {section.title}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                            {section.subtitle}
                                        </Typography>
                                    </Box>
                                    <Chip label={sectionConversations.length} size="small" sx={{ height: 22, flexShrink: 0 }} />
                                </Box>
                                {sectionConversations.map(renderConversation)}
                            </Box>
                        );
                    })
                )}
            </List>
        </Box>
    );
};

export default UnifiedSidebar;
