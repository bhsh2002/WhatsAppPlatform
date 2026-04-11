import React from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Typography,
    TextField,
    InputAdornment,
    Badge,
    CircularProgress
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

const ChatSidebar = ({
    conversations,
    selectedChat,
    onSelectChat,
    loading,
    searchTerm,
    setSearchTerm,
    getDisplayName,
    formatDate
}) => {
    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
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
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
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
                ) : conversations.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography>لا توجد محادثات</Typography>
                    </Box>
                ) : (
                    <List disablePadding>
                        {conversations.map((conv, idx) => {
                            const isSelected = selectedChat?.contact === conv.contact &&
                                (selectedChat?.tenant_id === conv.tenant_id || (!selectedChat?.tenant_id && !conv.tenant_id));

                            return (
                                <ListItem
                                    key={conv.contact + '_' + (conv.tenant_id || idx)}
                                    component="div"
                                    onClick={() => onSelectChat(conv)}
                                    sx={{
                                        cursor: 'pointer',
                                        borderBottom: '1px solid rgba(0,0,0,0.05)',
                                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                                        '&:hover': { bgcolor: 'action.hover' },
                                        py: 1.5,
                                        px: 2
                                    }}
                                >
                                    <ListItemAvatar>
                                        <Badge
                                            badgeContent={conv.unread_count}
                                            color="success"
                                            overlap="circular"
                                        >
                                            <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>
                                                {conv.profile_picture_url ? (
                                                    <img src={conv.profile_picture_url} alt="" style={{ width: '100%', height: '100%' }} />
                                                ) : (
                                                    (getDisplayName(conv) || '?')[0].toUpperCase()
                                                )}
                                            </Avatar>
                                        </Badge>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                                                <Typography variant="subtitle1" sx={{
                                                    fontWeight: conv.unread_count ? 700 : 400,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '0.95rem'
                                                }}>
                                                    {getDisplayName(conv)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>
                                                    {formatDate(conv.last_interaction)}
                                                </Typography>
                                            </Box>
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: '75%' }}>
                                                    {conv.last_message?.substring(0, 40) || 'صورة/ملف'}
                                                </Typography>
                                                {conv.tenant_name && (
                                                    <Box component="span" sx={{
                                                        bgcolor: 'primary.light',
                                                        color: 'primary.contrastText',
                                                        px: 0.5,
                                                        borderRadius: 0.5,
                                                        fontSize: '0.65rem',
                                                        opacity: 0.8
                                                    }}>
                                                        {conv.tenant_name}
                                                    </Box>
                                                )}
                                            </Box>
                                        }
                                    />
                                </ListItem>
                            );
                        })}
                    </List>
                )}
            </Box>
        </Box>
    );
};

export default ChatSidebar;
