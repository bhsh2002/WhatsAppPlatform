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
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    InputAdornment,
    IconButton,
    Tooltip,
    Button,
    CircularProgress
} from '@mui/material';
import {
    Search as SearchIcon,
    Refresh as RefreshIcon,
    WhatsApp as WhatsAppIcon,
    Facebook as FacebookIcon,
    Sync as SyncIcon
} from '@mui/icons-material';

const getChannelIcon = (channel) => {
    if (channel === 'whatsapp') return <WhatsAppIcon sx={{ fontSize: 14, color: '#25D366' }} />;
    return <FacebookIcon sx={{ fontSize: 14, color: '#0084ff' }} />;
};

const getChannelColor = (channel) => {
    if (channel === 'whatsapp') return '#25D366';
    return '#0084ff';
};

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
    const filtered = conversations.filter(c => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            (c.display_name || c.contact_id || '').toLowerCase().includes(term) ||
            (c.contact_id || '').includes(term) ||
            (c.tenant_name || '').toLowerCase().includes(term)
        );
    });

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
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel>القناة</InputLabel>
                        <Select
                            value={channelFilter ?? ''}
                            label="القناة"
                            onChange={e => setChannelFilter(e.target.value)}
                        >
                            <MenuItem value="">الكل</MenuItem>
                            <MenuItem value="whatsapp">واتساب فقط</MenuItem>
                            <MenuItem value="messenger">ماسنجر فقط</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
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
                    filtered.map((conv) => {
                        const isSelected = selectedChat &&
                            conv.channel === selectedChat.channel &&
                            conv.contact_id === selectedChat.contact_id &&
                            (conv.tenant_id || null) === (selectedChat.tenant_id || null);

                        const displayName = conv.display_name || conv.contact_id || 'غير معروف';
                        const channelColor = getChannelColor(conv.channel);

                        return (
                            <ListItem
                                key={`${conv.channel}-${conv.contact_id}-${conv.tenant_id || 'null'}`}
                                button
                                selected={isSelected}
                                onClick={() => onSelectChat(conv)}
                                sx={{
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                    '&.Mui-selected': { bgcolor: 'action.selected' },
                                }}
                            >
                                <ListItemAvatar>
                                    <Badge
                                        badgeContent={conv.unread_count || 0}
                                        color="error"
                                        invisible={!conv.unread_count}
                                    >
                                        <Avatar
                                            src={conv.avatar_url || undefined}
                                            sx={{ bgcolor: conv.avatar_url ? undefined : channelColor + '22' }}
                                        >
                                            {displayName.charAt(0)?.toUpperCase() || '?'}
                                        </Avatar>
                                    </Badge>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography
                                                variant="body2"
                                                fontWeight={conv.unread_count ? 700 : 400}
                                                sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            >
                                                {displayName}
                                            </Typography>
                                            <Chip
                                                icon={getChannelIcon(conv.channel)}
                                                label={conv.channel === 'whatsapp' ? 'WA' : '💬'}
                                                size="small"
                                                variant="outlined"
                                                sx={{
                                                    height: 20,
                                                    fontSize: 11,
                                                    borderColor: channelColor,
                                                    color: channelColor,
                                                    '& .MuiChip-icon': { fontSize: 12 },
                                                }}
                                            />
                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                                {formatDate(conv.last_message_time)}
                                            </Typography>
                                        </Box>
                                    }
                                    secondary={
                                        <Box>
                                            <Typography variant="body2" color="text.secondary" noWrap sx={{ fontSize: 12 }}>
                                                {conv.last_message || '—'}
                                            </Typography>
                                            {conv.tenant_name && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {conv.tenant_name}
                                                </Typography>
                                            )}
                                            {conv.page_name && (
                                                <Typography variant="caption" color="primary" sx={{ ml: conv.tenant_name ? 0.5 : 0 }}>
                                                    ({conv.page_name})
                                                </Typography>
                                            )}
                                        </Box>
                                    }
                                />
                            </ListItem>
                        );
                    })
                )}
            </List>
        </Box>
    );
};

export default UnifiedSidebar;