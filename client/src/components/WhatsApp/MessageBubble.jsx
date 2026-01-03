import React from 'react';
import { Box, Paper, Typography, Link } from '@mui/material';
import { FileOpen as FileIcon, Download as DownloadIcon } from '@mui/icons-material';

const MessageBubble = ({ message, isOutgoing, formatTime, getStatusIcon, getMediaDownloadUrl }) => {

    // Normalize message fields
    const type = message.type || message.message_type || 'text';
    const content = message.body || message.content || '';

    // Helper to render content based on type
    const renderContent = () => {
        if (type === 'text') {
            return (
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.95rem' }}>
                    {content}
                </Typography>
            );
        }

        if (type === 'image') {
            return (
                <Box sx={{ mb: 0.5 }}>
                    {/* Try to load directly from Meta or Proxy */}
                    <Box
                        component="img"
                        src={getMediaDownloadUrl(message.media_id, message.tenant_id)} // We need to ensure authentication is handled in URL
                        alt="صورة"
                        sx={{
                            maxWidth: '100%',
                            maxHeight: 300,
                            borderRadius: 1,
                            display: 'block',
                            cursor: 'pointer'
                        }}
                        onClick={() => window.open(getMediaDownloadUrl(message.media_id, message.tenant_id), '_blank')}
                    />
                    {message.caption && (
                        <Typography variant="body1" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                            {message.caption}
                        </Typography>
                    )}
                </Box>
            );
        }

        // Default or Document
        return (
            <Box>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 1,
                        bgcolor: 'rgba(0,0,0,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        borderColor: 'divider',
                        cursor: 'pointer'
                    }}
                    onClick={() => window.open(getMediaDownloadUrl(message.media_id, message.tenant_id), '_blank')}
                >
                    <FileIcon color="action" />
                    <Box sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                            {message.caption || 'مرفق'} ({(type || 'file').toUpperCase()})
                        </Typography>
                    </Box>
                    <DownloadIcon fontSize="small" color="action" />
                </Paper>
            </Box>
        );
    };

    return (
        <Box sx={{
            display: 'flex',
            justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
            mb: 0.5,
            px: { xs: 1, md: 4 }
        }}>
            <Paper elevation={1} sx={{
                p: '6px 10px',
                maxWidth: { xs: '85%', md: '65%' },
                bgcolor: isOutgoing ? '#d9fdd3' : '#ffffff',
                borderRadius: 2,
                borderTopRightRadius: isOutgoing ? 0 : 2,
                borderTopLeftRadius: !isOutgoing ? 0 : 2,
                position: 'relative',
                minWidth: '80px'
            }}>
                {renderContent()}

                <Box sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 0.5,
                    mt: -0.5,
                    opacity: 0.7
                }}>
                    <Typography variant="caption" sx={{ fontSize: '0.65rem', mt: 0.5 }}>
                        {formatTime(message.created_at)}
                    </Typography>
                    {isOutgoing && (
                        <Box component="span" sx={{ display: 'flex', alignItems: 'center' }}>
                            {getStatusIcon(message.status, message.direction)}
                        </Box>
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

export default MessageBubble;
