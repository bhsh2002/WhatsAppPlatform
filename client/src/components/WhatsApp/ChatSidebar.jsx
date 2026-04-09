import React from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Typography,
    TextField,
    InputAdornment,
    Badge,
    IconButton,
    Paper
} from '@mui/material';
import { Search as SearchIcon, MoreVert as MoreVertIcon, Message as MessageIcon } from '@mui/icons-material';

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
            borderRight: { md: '1px solid rgba(0,0,0,0.12)' },
            bgcolor: 'background.paper'
        }}>
            {/* Header */}
            <Box sx={{
                p: 2,
                bgcolor: 'background.default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <Avatar sx={{ bgcolor: 'secondary.light' }}>
                    <MessageIcon />
                </Avatar>
                <Box>
                    <IconButton>
                        <MoreVertIcon />
                    </IconButton>
                </Box>
            </Box>

            {/* Search */}
            <Box sx={{ p: 1, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="بحث في المحادثات..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" color="action" />
                            </InputAdornment>
                        ),
                        sx: { borderRadius: 2, bgcolor: 'background.default' }
                    }}
                />
            </Box>

            {/* List */}
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
                <List sx={{ p: 0 }}>
                    {loading ? (
                        <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>jاري التحميل...</Box>
                    ) : conversations.length === 0 ? (
                        <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>لا توجد محادثات</Box>
                    ) : (
                        conversations.map((conv, idx) => (
                            <ListItem key={idx} disablePadding disableGutters divider>
                                <ListItemButton
                                    onClick={() => onSelectChat(conv)}
                                    selected={selectedChat?.contact === conv.contact && selectedChat?.tenant_id === conv.tenant_id}
                                    sx={{
                                        px: 2,
                                        py: 1.5,
                                        '&.Mui-selected': { bgcolor: 'action.selected' },
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                >
                                    <ListItemAvatar>
                                        <Box sx={{ position: 'relative' }}>
                                            <Avatar
                                                src={conv.profile_picture_url}
                                                sx={{ width: 50, height: 50 }}
                                            >
                                                {!conv.profile_picture_url && '👤'}
                                            </Avatar>
                                        </Box>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {getDisplayName(conv)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>
                                                    {formatDate(conv.last_interaction)}
                                                </Typography>
                                            </Box>
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: '70%' }}>
                                                    {conv.last_message || 'صورة/ملف'}
                                                </Typography>
                                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
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
                                                    {conv.unread_count > 0 && (
                                                        <Badge badgeContent={conv.unread_count} color="success" />
                                                    )}
                                                </Box>
                                            </Box>
                                        }
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))
                    )}
                </List>
            </Box>
        </Box>
    );
};

export default ChatSidebar;
