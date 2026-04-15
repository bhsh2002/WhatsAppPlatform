import React, { useState } from 'react';
import { Box, Paper, Typography, Link, Dialog, IconButton, Chip } from '@mui/material';
import {
    FileOpen as FileIcon,
    Download as DownloadIcon,
    Close as CloseIcon,
    BrokenImage as BrokenImageIcon,
    SmartButton as ButtonIcon,
    List as ListIcon,
    Reply as ReplyIcon,
    LocationOn as LocationIcon,
    Contacts as ContactsIcon
} from '@mui/icons-material';

const MessageBubble = ({ message, isOutgoing, formatTime, getStatusIcon, getMediaDownloadUrl }) => {

    const [imageError, setImageError] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);

    // Normalize message fields
    const type = message.type || message.message_type || 'text';
    const content = message.body || message.content || '';

    // Helper to render interactive message content
    const renderInteractive = () => {
        let data = null;

        // Try to parse content as JSON
        try {
            if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
                data = JSON.parse(content);
            }
        } catch (_e) {
            // Not JSON
        }

        if (!data) {
            // Fallback: plain text interactive
            return (
                <Box>
                    <Chip
                        icon={<ButtonIcon />}
                        label="رسالة تفاعلية"
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ mb: 0.5 }}
                    />
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content}
                    </Typography>
                </Box>
            );
        }

        const interactiveType = data.type || 'button';

        return (
            <Box sx={{ minWidth: { xs: 0, md: 200 } }}>
                {/* Header */}
                {data.header && (
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                        {data.header}
                    </Typography>
                )}

                {/* Body */}
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: 0.5 }}>
                    {data.body || content}
                </Typography>

                {/* Footer */}
                {data.footer && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        {data.footer}
                    </Typography>
                )}

                {/* Buttons */}
                {interactiveType === 'button' && data.buttons && Array.isArray(data.buttons) && (
                    <Box sx={{ mt: 1, borderTop: '1px solid rgba(0,0,0,0.08)', pt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {data.buttons.map((btn, i) => (
                            <Box key={i} sx={{
                                bgcolor: 'rgba(0,0,0,0.04)',
                                p: 0.8,
                                borderRadius: 1,
                                textAlign: 'center',
                                fontSize: '0.875rem',
                                color: 'primary.main',
                                fontWeight: 500,
                                cursor: 'default'
                            }}>
                                {btn.title || btn.text || btn}
                            </Box>
                        ))}
                    </Box>
                )}

                {/* List Button */}
                {interactiveType === 'list' && (
                    <Box sx={{
                        mt: 1,
                        borderTop: '1px solid rgba(0,0,0,0.08)',
                        pt: 1,
                        textAlign: 'center'
                    }}>
                        <Box sx={{
                            bgcolor: 'rgba(0,0,0,0.04)',
                            p: 0.8,
                            borderRadius: 1,
                            fontSize: '0.875rem',
                            color: 'primary.main',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.5,
                            cursor: 'default'
                        }}>
                            <ListIcon fontSize="small" />
                            {data.list_button || 'عرض الخيارات'}
                        </Box>
                    </Box>
                )}
            </Box>
        );
    };

    // Render button_reply or list_reply (incoming response from user)
    const renderInteractiveReply = () => {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ReplyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.95rem' }}>
                    {content}
                </Typography>
            </Box>
        );
    };

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
            const mediaUrl = getMediaDownloadUrl(message.media_id, message.tenant_id);
            return (
                <Box sx={{ mb: 0.5 }}>
                    {imageError ? (
                        <Box sx={{
                            width: '100%',
                            minHeight: 150,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(0,0,0,0.05)',
                            borderRadius: 1,
                            gap: 1
                        }}>
                            <BrokenImageIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                            <Typography variant="caption" color="text.secondary">
                                تعذر تحميل الصورة
                            </Typography>
                            <Link href={mediaUrl} target="_blank" rel="noopener" sx={{ fontSize: '0.75rem' }}>
                                فتح الرابط
                            </Link>
                        </Box>
                    ) : (
                        <Box
                            component="img"
                            src={mediaUrl}
                            alt="صورة"
                            sx={{
                                maxWidth: '100%',
                                width: '100%',
                                maxHeight: { xs: 200, sm: 250, md: 300 },
                                objectFit: 'contain',
                                borderRadius: 1,
                                display: 'block',
                                cursor: 'pointer'
                            }}
                            onClick={() => setLightboxOpen(true)}
                            onError={() => setImageError(true)}
                        />
                    )}
                    {message.caption && (
                        <Typography variant="body1" sx={{ mt: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {message.caption}
                        </Typography>
                    )}
                    {/* Also check content for caption if it's not a placeholder */}
                    {!message.caption && content && !content.startsWith('[') && (
                        <Typography variant="body1" sx={{ mt: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {content}
                        </Typography>
                    )}

                    {/* Image Lightbox */}
                    <Dialog open={lightboxOpen} onClose={() => setLightboxOpen(false)} maxWidth="lg">
                        <Box sx={{ position: 'relative' }}>
                            <IconButton
                                onClick={() => setLightboxOpen(false)}
                                sx={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    bgcolor: 'rgba(0,0,0,0.5)',
                                    color: 'white',
                                    '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' }
                                }}
                            >
                                <CloseIcon />
                            </IconButton>
                            <Box
                                component="img"
                                src={mediaUrl}
                                alt="صورة"
                                sx={{ maxWidth: '90vw', maxHeight: '90vh', display: 'block' }}
                            />
                        </Box>
                    </Dialog>
                </Box>
            );
        }

        if (type === 'template') {
            let templateData = null;
            try {
                if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
                    templateData = JSON.parse(content);
                }
            } catch (_e) {
                // Content is plain text
            }

            if (templateData && typeof templateData === 'object') {
                return (
                    <Box sx={{ minWidth: { xs: 0, md: 200 } }}>
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

            // Fallback for simple template text
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

        // Interactive message
        if (type === 'interactive') {
            return renderInteractive();
        }

        // Button reply / List reply (user responses to interactive messages)
        if (type === 'button' || type === 'button_reply' || type === 'list_reply') {
            return renderInteractiveReply();
        }

        // Location
        if (type === 'location') {
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LocationIcon sx={{ color: 'error.main' }} />
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content}
                    </Typography>
                </Box>
            );
        }

        // Contacts
        if (type === 'contacts') {
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ContactsIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {content || '[جهة اتصال]'}
                    </Typography>
                </Box>
            );
        }

        // Sticker
        if (type === 'sticker') {
            const mediaUrl = getMediaDownloadUrl(message.media_id, message.tenant_id);
            return (
                <Box sx={{ mb: 0.5 }}>
                    <Box
                        component="img"
                        src={mediaUrl}
                        alt="ملصق"
                        sx={{ width: { xs: 120, md: 150 }, height: { xs: 120, md: 150 }, display: 'block', objectFit: 'contain' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
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
                <Box sx={{ minWidth: 0, maxWidth: 200, overflow: 'hidden' }}>
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
                            minWidth: 0,
                            overflow: 'hidden',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.08)' }
                        }}
                        onClick={() => {
                            if (mediaId) {
                                window.open(getMediaDownloadUrl(mediaId, message.tenant_id), '_blank');
                            }
                        }}
                    >
                        <Box component="span" sx={{ flexShrink: 0 }}><FileIcon color="action" /></Box>
                        <Box sx={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        <Box component="span" sx={{ flexShrink: 0 }}><DownloadIcon fontSize="small" color="action" /></Box>
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
            px: { xs: 1, md: 4 },
            minWidth: 0
        }}>
            <Paper elevation={1} sx={{
                p: '6px 10px',
                maxWidth: { xs: '85%', md: '65%' },
                bgcolor: isOutgoing ? '#d9fdd3' : '#ffffff',
                borderRadius: 2,
                borderTopRightRadius: isOutgoing ? 0 : 2,
                borderTopLeftRadius: !isOutgoing ? 0 : 2,
                position: 'relative',
                minWidth: '80px',
                overflow: 'hidden',
                wordBreak: 'break-word'
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
