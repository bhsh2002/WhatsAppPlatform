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

        if (type === 'template') {
            let templateData = null;
            try {
                // Try to parse if content is JSON
                if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
                    templateData = JSON.parse(content);
                }
            } catch (_e) {
                // Content is plain text
            }

            if (templateData && typeof templateData === 'object') {
                return (
                    <Box sx={{ minWidth: 200 }}>
                        {templateData.header && (
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                                {templateData.header.type === 'IMAGE' ? '[صورة]' :
                                    templateData.header.type === 'VIDEO' ? '[فيديو]' :
                                        templateData.header.type === 'DOCUMENT' ? '[مستند]' :
                                            templateData.header.text || ''}
                            </Typography>
                        )}
                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: 1 }}>
                            {templateData.body?.text || templateData.body || content}
                        </Typography>
                        {templateData.footer && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                                {templateData.footer.text || templateData.footer}
                            </Typography>
                        )}
                        {templateData.buttons && Array.isArray(templateData.buttons) && (
                            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {templateData.buttons.map((btn, i) => (
                                    <Box key={i} sx={{
                                        bgcolor: 'rgba(0,0,0,0.05)',
                                        p: 1,
                                        borderRadius: 1,
                                        textAlign: 'center',
                                        fontSize: '0.875rem',
                                        color: 'primary.main',
                                        fontWeight: 500
                                    }}>
                                        {btn.text}
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                );
            }

            // Fallback for simple template text (e.g., "payment_reminder")
            return (
                <Box>
                    <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mb: 0.5 }}>
                        رسالة قالب
                    </Typography>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content}
                    </Typography>
                </Box>
            );
        }

        // Document, Video, or Audio media types
        if (type === 'document' || type === 'video' || type === 'audio') {
            const mediaId = message.media_id || message.media_url;
            
            // Parse filename and caption from content
            // Format: "filename\n\ncaption" or just "filename"
            const contentLines = (content || '').split('\n\n');
            const filename = contentLines[0] || 'مستند';
            const caption = contentLines.length > 1 ? contentLines.slice(1).join('\n\n') : '';
            
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
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.08)' }
                        }}
                        onClick={() => {
                            if (mediaId) {
                                window.open(getMediaDownloadUrl(mediaId, message.tenant_id), '_blank');
                            }
                        }}
                    >
                        <FileIcon color="action" />
                        <Box sx={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                                {filename}
                            </Typography>
                            {caption && (
                                <Typography variant="caption" color="text.secondary" sx={{ 
                                    display: '-webkit-box', 
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                }}>
                                    {caption}
                                </Typography>
                            )}
                        </Box>
                        <DownloadIcon fontSize="small" color="action" />
                    </Paper>
                </Box>
            );
        }

        // Unknown type - render as text
        return (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {content}
            </Typography>
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
