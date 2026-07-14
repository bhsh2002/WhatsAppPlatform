import React, { useState } from 'react';
import { Box, Paper, Typography, Link, Dialog, IconButton, Chip } from '@mui/material';
import { FileOpen as FileIcon, Download as DownloadIcon, Close as CloseIcon, BrokenImage as BrokenImageIcon, SmartButton as ButtonIcon, List as ListIcon, Reply as ReplyIcon, LocationOn as LocationIcon, Contacts as ContactsIcon } from '@mui/icons-material';
import { normalizeFilename } from '../../utils/filenames';
import { tx } from "../../i18n/tx";
const MessageBubble = ({
  message,
  isOutgoing,
  formatTime,
  getStatusIcon,
  getMediaDownloadUrl
}) => {
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Normalize message fields
  const rawType = message.type || message.message_type || 'text';
  const content = message.body || message.content || '';
  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const reactionMatch = normalizedContent.match(/^\[reaction:\s*(.*?)\]$/i);
  const reactionEmoji = message.reaction?.emoji || message.reaction_emoji || reactionMatch?.[1] || '';
  const isReactionMessage = String(rawType).toLowerCase() === 'reaction'
    || /^\[reaction message\]$/i.test(normalizedContent)
    || Boolean(reactionMatch);
  const isLegacyTemplatePayload = (() => {
    if (typeof content !== 'string' || !content.trim().startsWith('{')) return false;
    try {
      const data = JSON.parse(content);
      return Boolean(data?.template && Array.isArray(data?.params));
    } catch {
      return false;
    }
  })();
  const type = isReactionMessage ? 'reaction' : rawType === 'text' && isLegacyTemplatePayload ? 'template' : rawType;
  const getHeaderMediaUrl = header => header?.url || header?.link || (typeof header?.text === 'string' && /^https?:\/\//i.test(header.text) ? header.text : '');
  const renderTemplateHeader = header => {
    if (!header) return null;
    const headerType = String(header.type || '').toLowerCase();
    const mediaUrl = getHeaderMediaUrl(header);
    const filename = normalizeFilename(header.filename || !mediaUrl && header.text || '', headerType === 'document' ? tx("auto.k_95686edc5cc2") : tx("auto.k_e3d245840251"));
    if (headerType === 'image') {
      return mediaUrl && !imageError ? <Box component="img" src={mediaUrl} alt={tx("auto.k_aa40faad59e1")} sx={{
        width: '100%',
        maxHeight: 220,
        objectFit: 'cover',
        borderRadius: 1,
        mb: 1
      }} onError={() => setImageError(true)} /> : <Typography variant="subtitle2" sx={{
        mb: 1,
        fontWeight: 'bold'
      }}>{tx("auto.k_d0e105ad414b")}</Typography>;
    }
    if (headerType === 'video') {
      return <Box sx={{
        mb: 1
      }}>
                    <Chip label={tx("auto.k_06b0167805a1")} size="small" color="primary" variant="outlined" />
                    {mediaUrl && <Link href={mediaUrl} target="_blank" rel="noopener" display="block" sx={{
          mt: 0.5,
          wordBreak: 'break-all'
        }}>{tx("auto.k_e0ea96851a87")}

          </Link>}
                </Box>;
    }
    if (headerType === 'document') {
      return <Paper variant="outlined" component={mediaUrl ? 'a' : 'div'} href={mediaUrl || undefined} target={mediaUrl ? '_blank' : undefined} rel={mediaUrl ? 'noopener' : undefined} sx={{
        p: 1,
        mb: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'rgba(0,0,0,0.04)',
        color: 'inherit',
        textDecoration: 'none',
        borderColor: 'divider'
      }}>

                    <FileIcon fontSize="small" color="action" />
                    <Typography variant="body2" sx={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
                        {filename}
                    </Typography>
                    {mediaUrl && <DownloadIcon fontSize="small" color="action" />}
                </Paper>;
    }
    return <Typography variant="subtitle2" sx={{
      mb: 1,
      fontWeight: 'bold'
    }}>
                {header.text || ''}
            </Typography>;
  };

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
      return <Box>
                    <Chip icon={<ButtonIcon />} label={tx("auto.k_c8f8c9313a7a")} size="small" color="primary" variant="outlined" sx={{
          mb: 0.5
        }} />

                    <Typography variant="body1" sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                        {content}
                    </Typography>
                </Box>;
    }
    const interactiveType = data.type || 'button';
    return <Box sx={{
      minWidth: {
        xs: 0,
        md: 200
      }
    }}>
                {/* Header */}
                {data.header && <Typography variant="subtitle2" sx={{
        fontWeight: 'bold',
        mb: 0.5
      }}>
                        {data.header}
                    </Typography>}

                {/* Body */}
                <Typography variant="body1" sx={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        mb: 0.5
      }}>
                    {data.body || content}
                </Typography>

                {/* Footer */}
                {data.footer && <Typography variant="caption" color="text.secondary" display="block" sx={{
        mb: 1
      }}>
                        {data.footer}
                    </Typography>}

                {/* Buttons */}
                {interactiveType === 'button' && data.buttons && Array.isArray(data.buttons) && <Box sx={{
        mt: 1,
        borderTop: '1px solid rgba(0,0,0,0.08)',
        pt: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5
      }}>
                        {data.buttons.map((btn, i) => <Box key={i} sx={{
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
                            </Box>)}
                    </Box>}

                {/* List Button */}
                {interactiveType === 'list' && <Box sx={{
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
                            {data.list_button || tx("auto.k_6330cdb18c10")}
                        </Box>
                    </Box>}
            </Box>;
  };

  // Render button_reply or list_reply (incoming response from user)
  const renderInteractiveReply = () => {
    return <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.5
    }}>
                <ReplyIcon sx={{
        fontSize: 16,
        color: 'text.secondary'
      }} />
                <Typography variant="body1" sx={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.95rem'
      }}>
                    {content}
                </Typography>
            </Box>;
  };

  // Helper to render content based on type
  const renderContent = () => {
    if (type === 'reaction') {
      return <Chip size="small" variant="outlined" color="default" label={reactionEmoji ? tx("inbox.reactionWithEmoji", {
        emoji: reactionEmoji
      }) : tx("inbox.reactionMessage")} sx={{
        maxWidth: '100%',
        '& .MuiChip-label': {
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }} />;
    }
    if (type === 'text') {
      return <Typography variant="body1" sx={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.95rem'
      }}>
                    {content}
                </Typography>;
    }
    if (type === 'image') {
      const mediaUrl = getMediaDownloadUrl(message.media_id, message.tenant_id);
      return <Box sx={{
        mb: 0.5
      }}>
                    {imageError ? <Box sx={{
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
                            <BrokenImageIcon sx={{
            fontSize: 40,
            color: 'text.disabled'
          }} />
                            <Typography variant="caption" color="text.secondary">{tx("auto.k_587e470dd3c4")}

            </Typography>
                            <Link href={mediaUrl} target="_blank" rel="noopener" sx={{
            fontSize: '0.75rem'
          }}>{tx("auto.k_697dcb281002")}

            </Link>
                        </Box> : <Box component="img" src={mediaUrl} alt={tx("auto.k_b941956874fe")} sx={{
          maxWidth: '100%',
          width: '100%',
          maxHeight: {
            xs: 200,
            sm: 250,
            md: 300
          },
          objectFit: 'contain',
          borderRadius: 1,
          display: 'block',
          cursor: 'pointer'
        }} onClick={() => setLightboxOpen(true)} onError={() => setImageError(true)} />}
                    {message.caption && <Typography variant="body1" sx={{
          mt: 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                            {message.caption}
                        </Typography>}
                    {/* Also check content for caption if it's not a placeholder */}
                    {!message.caption && content && !content.startsWith('[') && <Typography variant="body1" sx={{
          mt: 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                            {content}
                        </Typography>}

                    {/* Image Lightbox */}
                    <Dialog open={lightboxOpen} onClose={() => setLightboxOpen(false)} maxWidth="lg" slotProps={{ paper: { 'aria-label': tx("auto.k_b941956874fe") } }}>
                        <Box sx={{
            position: 'relative'
          }}>
                            <IconButton aria-label={tx("auto.k_e776b0209b50")} onClick={() => setLightboxOpen(false)} sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.5)',
              color: 'white',
              '&:hover': {
                bgcolor: 'rgba(0,0,0,0.7)'
              }
            }}>

                                <CloseIcon />
                            </IconButton>
                            <Box component="img" src={mediaUrl} alt={tx("auto.k_b941956874fe")} sx={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'block'
            }} />

                        </Box>
                    </Dialog>
                </Box>;
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
        if (templateData.template && Array.isArray(templateData.params)) {
          return <Box sx={{
            minWidth: {
              xs: 0,
              md: 200
            }
          }}>
                            <Chip label={tx("auto.k_b98223ae5781")} size="small" color="primary" variant="outlined" sx={{
              mb: 0.75
            }} />

                            <Typography variant="subtitle2" sx={{
              fontWeight: 700,
              mb: 0.75,
              direction: 'ltr',
              textAlign: 'left'
            }}>
                                {templateData.template}
                            </Typography>
                            {templateData.params.length > 0 && <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5
            }}>
                                    {templateData.params.map((param, index) => <Typography key={index} variant="body2" sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                                            {`{{${index + 1}}}: ${param}`}
                                        </Typography>)}
                                </Box>}
                        </Box>;
        }
        return <Box sx={{
          minWidth: {
            xs: 0,
            md: 200
          }
        }}>
                        {renderTemplateHeader(templateData.header)}
                        <Typography variant="body1" sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            mb: 1
          }}>
                            {templateData.body?.text || templateData.body || content}
                        </Typography>
                        {templateData.footer && <Typography variant="caption" color="text.secondary" display="block" sx={{
            mb: 1
          }}>
                                {templateData.footer.text || templateData.footer}
                            </Typography>}
                        {templateData.buttons && Array.isArray(templateData.buttons) && <Box sx={{
            mt: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5
          }}>
                                {templateData.buttons.map((btn, i) => <Box key={i} sx={{
              bgcolor: 'rgba(0,0,0,0.05)',
              p: 1,
              borderRadius: 1,
              textAlign: 'center',
              fontSize: '0.875rem',
              color: 'primary.main',
              fontWeight: 500
            }}>
                                        {btn.text}
                                    </Box>)}
                            </Box>}
                    </Box>;
      }

      // Fallback for simple template text
      return <Box>
                    <Typography variant="caption" sx={{
          color: 'primary.main',
          display: 'block',
          mb: 0.5
        }}>{tx("auto.k_b98223ae5781")}

          </Typography>
                    <Typography variant="body1" sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                        {content}
                    </Typography>
                </Box>;
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
      return <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5
      }}>
                    <LocationIcon sx={{
          color: 'error.main'
        }} />
                    <Typography variant="body1" sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                        {content}
                    </Typography>
                </Box>;
    }

    // Contacts
    if (type === 'contacts') {
      return <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5
      }}>
                    <ContactsIcon sx={{
          color: 'primary.main'
        }} />
                    <Typography variant="body1" sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
                        {content || tx("auto.k_9a64b7cbc36c")}
                    </Typography>
                </Box>;
    }

    // Sticker
    if (type === 'sticker') {
      const mediaUrl = getMediaDownloadUrl(message.media_id, message.tenant_id);
      return <Box sx={{
        mb: 0.5
      }}>
                    <Box component="img" src={mediaUrl} alt={tx("auto.k_f9cffb2a908e")} sx={{
          width: {
            xs: 120,
            md: 150
          },
          height: {
            xs: 120,
            md: 150
          },
          display: 'block',
          objectFit: 'contain'
        }} onError={e => {
          e.target.style.display = 'none';
        }} />

                </Box>;
    }

    // Document, Video, or Audio media types
    if (type === 'document' || type === 'video' || type === 'audio') {
      const mediaId = message.media_id || message.media_url;

      // Parse filename and caption from content
      // Format: "filename\n\ncaption" or just "filename"
      const contentLines = (content || '').split('\n\n');
      const rawFilename = contentLines[0] || tx("auto.k_d9381107732e");
      const wrappedFilename = rawFilename.match(/^\[(?:Document|Video|Audio):\s*(.*?)\]$/i)?.[1] || rawFilename;
      const filename = normalizeFilename(wrappedFilename === `[${type}]` ? '' : wrappedFilename, type === 'document' ? tx("auto.k_d9381107732e") : tx("auto.k_f79517c85cf5"));
      const caption = contentLines.length > 1 ? contentLines.slice(1).join('\n\n') : '';
      return <Box sx={{
        minWidth: 0,
        maxWidth: {
          xs: '70vw',
          md: '50vw'
        },
        overflow: 'hidden'
      }}>
                    <Paper variant="outlined" sx={{
          p: 1,
          bgcolor: 'rgba(0,0,0,0.05)',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderColor: 'divider',
          cursor: 'pointer',
          minWidth: 0,
          overflow: 'hidden',
          '&:hover': {
            bgcolor: 'rgba(0,0,0,0.08)'
          }
        }} onClick={() => {
          if (mediaId) {
            window.open(getMediaDownloadUrl(mediaId, message.tenant_id), '_blank');
          }
        }}>

                        <Box component="span" sx={{
            flexShrink: 0
          }}><FileIcon color="action" /></Box>
                        <Box sx={{
            overflow: 'hidden',
            flex: 1,
            minWidth: 0
          }}>
                            <Typography variant="body2" sx={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
                                {filename}
                            </Typography>
                            {caption && <Typography variant="caption" color="text.secondary" sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}>
                                    {caption}
                                </Typography>}
                        </Box>
                        <Box component="span" sx={{
            flexShrink: 0
          }}><DownloadIcon fontSize="small" color="action" /></Box>
                    </Paper>
                </Box>;
    }

    // Unknown type - render as text
    return <Typography variant="body1" sx={{
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }}>
                {content}
            </Typography>;
  };
  return <Box sx={{
    display: 'flex',
    justifyContent: isOutgoing ? 'flex-end' : 'flex-start',
    mb: 0.5,
    px: {
      xs: 1,
      md: 4
    },
    minWidth: 0
  }}>
            <Paper elevation={1} sx={{
      p: '6px 10px',
      maxWidth: {
        xs: '85%',
        md: '65%'
      },
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
                    <Typography variant="caption" sx={{
          fontSize: '0.65rem',
          mt: 0.5
        }}>
                        {formatTime(message.created_at)}
                    </Typography>
                    {isOutgoing && <Box component="span" sx={{
          display: 'flex',
          alignItems: 'center'
        }}>
                            {getStatusIcon(message.status, message.direction)}
                        </Box>}
                </Box>
            </Paper>
        </Box>;
};
export default MessageBubble;
