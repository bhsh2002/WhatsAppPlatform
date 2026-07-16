import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, TextField, MenuItem, FormControl,
    InputLabel, CircularProgress, Alert, Chip, Avatar, IconButton,
    Card, CardContent, CardMedia, CardActions, Collapse, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider, Tooltip,
    RadioGroup, Radio, FormControlLabel, Switch
} from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import {
    Facebook as FacebookIcon, Send as SendIcon, Delete as DeleteIcon,
    Edit as EditIcon, Refresh as RefreshIcon,
    ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
    ChatBubble as CommentIcon, OpenInNew as OpenInNewIcon,
    CloudUpload as UploadIcon, SmartToy as AutomationIcon, Bolt as BoltIcon,
    ThumbUp as LikeIcon, Share as ShareIcon,
    Inventory2Outlined as ProductIcon
} from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import {
    buildFacebookPostProductDraft,
    formatFacebookContentTime
} from '../Facebook/facebookContentConfig';
import {
    FacebookContentSnackbar,
    FacebookDeleteDialog,
    FacebookPostComposerTabs,
    FacebookPostMessage,
    FacebookPostProductDialog
} from '../Facebook/FacebookContentPresentation';

const TenantContentManager = ({ embedded = false }) => {
    const { locale, t } = useLanguage();
    const [pages, setPages] = useState([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [pagesLoading, setPagesLoading] = useState(true);
    const [pagesError, setPagesError] = useState('');

    const [posts, setPosts] = useState([]);
    const [postsPaging, setPostsPaging] = useState(null);
    const [postsLoading, setPostsLoading] = useState(false);
    const [postsError, setPostsError] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);

    const [composerTab, setComposerTab] = useState('text');
    const [composerMessage, setComposerMessage] = useState('');
    const [composerLink, setComposerLink] = useState('');
    const [composerPhotoUrl, setComposerPhotoUrl] = useState('');
    const [composerPhotoFile, setComposerPhotoFile] = useState(null);
    const [composerCaption, setComposerCaption] = useState('');
    const [composerScheduleTime, setComposerScheduleTime] = useState('');
    const [publishing, setPublishing] = useState(false);

    const [expandedComments, setExpandedComments] = useState({});
    const [expandedPosts, setExpandedPosts] = useState({});
    const [commentsData, setCommentsData] = useState({});
    const [commentsLoading, setCommentsLoading] = useState({});
    const [repliesData, setRepliesData] = useState({});
    const [repliesLoading, setRepliesLoading] = useState({});
    const [replyTexts, setReplyTexts] = useState({});
    const [replyLoading, setReplyLoading] = useState({});
    const [likedPosts, setLikedPosts] = useState({});
    const [commentTexts, setCommentTexts] = useState({});
    const [commentSubmitting, setCommentSubmitting] = useState({});

    const [editingPostId, setEditingPostId] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteType, setDeleteType] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);

    const [productDialogOpen, setProductDialogOpen] = useState(false);
    const [productDraft, setProductDraft] = useState(null);
    const [productSaving, setProductSaving] = useState(false);

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const [autoDialogOpen, setAutoDialogOpen] = useState(false);
    const [autoTargetPost, setAutoTargetPost] = useState(null);
    const [autoRules, setAutoRules] = useState([]);
    const [autoRulesLoading, setAutoRulesLoading] = useState(false);
    const [autoForm, setAutoForm] = useState({
        name: '', match_pattern: '', response_text: '', dm_text: '',
        response_action: 'comment', cooldown_seconds: 300, trigger_on: 'comment',
        auto_like: false,
    });
    const [autoSaving, setAutoSaving] = useState(false);

    const selectedPage = pages.find(p => p.id === selectedPageId);

    const loadPages = useCallback(async () => {
        try {
            setPagesLoading(true);
            setPagesError('');
            const data = await api.getPortalPages();
            setPages(Array.isArray(data) ? data : []);
            if (data.length > 0 && !selectedPageId) {
                setSelectedPageId(data[0].id);
            }
        } catch (err) {
            setPagesError(err.message || t('facebookContent.messages.pagesFetchFailed'));
            setPages([]);
        } finally {
            setPagesLoading(false);
        }
    }, [selectedPageId, t]);

    useEffect(() => { loadPages(); }, [loadPages]);

    const loadPosts = useCallback(async (append = false, afterCursor = null) => {
        if (!selectedPageId) return;
        try {
            if (!append) setPostsLoading(true);
            else setLoadingMore(true);
            setPostsError('');
            const params = {};
            if (append && afterCursor) {
                params.after = afterCursor;
            }
            const data = await api.getPortalFbPosts(selectedPageId, params);
            if (append) {
                setPosts(prev => [...prev, ...(data.posts || [])]);
            } else {
                setPosts(data.posts || []);
            }
            setPostsPaging(data.paging || null);
        } catch (err) {
            setPostsError(err.message || t('facebookContent.messages.postsFetchFailed'));
        } finally {
            setPostsLoading(false);
            setLoadingMore(false);
        }
    }, [selectedPageId, t]);

    useEffect(() => {
        if (selectedPageId) {
            setPosts([]);
            setPostsPaging(null);
            setExpandedComments({});
            setCommentsData({});
            setRepliesData({});
            loadPosts();
        }
    }, [selectedPageId, loadPosts]);

    const handlePublish = async () => {
        if (!selectedPageId) return;
        try {
            setPublishing(true);
            if (composerTab === 'photo' && composerPhotoFile) {
                const formData = new FormData();
                formData.append('source', composerPhotoFile);
                if (composerCaption) formData.append('caption', composerCaption);
                await api.createPortalFbPhotoPostFile(selectedPageId, formData);
            } else if (composerTab === 'photo' && composerPhotoUrl) {
                await api.createPortalFbPhotoPostUrl(selectedPageId, {
                    url: composerPhotoUrl,
                    caption: composerCaption || undefined,
                });
            } else if (composerTab === 'link') {
                await api.createPortalFbPost(selectedPageId, {
                    message: composerMessage || undefined,
                    link: composerLink || undefined,
                });
            } else if (composerTab === 'schedule') {
                await api.createPortalFbPost(selectedPageId, {
                    message: composerMessage,
                    published: false,
                    scheduled_publish_time: composerScheduleTime,
                });
            } else {
                if (!composerMessage.trim()) return;
                await api.createPortalFbPost(selectedPageId, { message: composerMessage });
            }
            setComposerMessage('');
            setComposerLink('');
            setComposerPhotoUrl('');
            setComposerCaption('');
            setComposerPhotoFile(null);
            setComposerScheduleTime('');
            setSnackbar({ open: true, message: t('facebookContent.messages.postPublished'), severity: 'success' });
            loadPosts();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.postPublishFailed'), severity: 'error' });
        } finally {
            setPublishing(false);
        }
    };

    const canPublish = () => {
        if (composerTab === 'photo') return !!(composerPhotoFile || composerPhotoUrl.trim());
        if (composerTab === 'link') return !!composerLink.trim();
        if (composerTab === 'schedule') return !!composerMessage.trim() && !!composerScheduleTime;
        return !!composerMessage.trim();
    };

    const loadComments = async (postId, append = false) => {
        try {
            setCommentsLoading(prev => ({ ...prev, [postId]: true }));
            const current = commentsData[postId] || { comments: [], paging: null };
            const params = { limit: 25, filter: 'toplevel' };
            if (append && current.paging?.cursors?.after) params.after = current.paging.cursors.after;
            const data = await api.getPortalFbComments(selectedPageId, postId, params);
            setCommentsData(prev => ({
                ...prev,
                [postId]: {
                    comments: append
                        ? [...(prev[postId]?.comments || []), ...(data.comments || [])]
                        : (data.comments || []),
                    paging: data.paging || null,
                    summary: data.summary || null,
                }
            }));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.commentsFetchFailed'), severity: 'error' });
        } finally {
            setCommentsLoading(prev => ({ ...prev, [postId]: false }));
        }
    };

    const loadReplies = async (commentId, append = false) => {
        try {
            setRepliesLoading(prev => ({ ...prev, [commentId]: true }));
            const current = repliesData[commentId] || { replies: [], paging: null };
            const params = { limit: 10 };
            if (append && current.paging?.cursors?.after) params.after = current.paging.cursors.after;
            const data = await api.getPortalFbCommentReplies(selectedPageId, commentId, params);
            setRepliesData(prev => ({
                ...prev,
                [commentId]: {
                    replies: append
                        ? [...(prev[commentId]?.replies || []), ...(data.replies || [])]
                        : (data.replies || []),
                    paging: data.paging || null,
                    summary: data.summary || null,
                }
            }));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.repliesFetchFailed'), severity: 'error' });
        } finally {
            setRepliesLoading(prev => ({ ...prev, [commentId]: false }));
        }
    };

    const toggleComments = (postId) => {
        if (expandedComments[postId]) {
            setExpandedComments(prev => ({ ...prev, [postId]: false }));
        } else {
            setExpandedComments(prev => ({ ...prev, [postId]: true }));
            if (!commentsData[postId]) loadComments(postId);
        }
    };

    const handleReply = async (commentId, postId) => {
        const message = replyTexts[commentId];
        if (!message?.trim() || !selectedPageId) return;
        try {
            setReplyLoading(prev => ({ ...prev, [commentId]: true }));
            const result = await api.replyPortalFbComment(selectedPageId, commentId, message);
            setReplyTexts(prev => ({ ...prev, [commentId]: '' }));
            // Optimistic: add new reply locally
            if (result?.id) {
                setRepliesData(prev => ({
                    ...prev,
                    [commentId]: {
                        ...prev[commentId],
                        replies: [...(prev[commentId]?.replies || []), {
                            id: result.id,
                            message: message,
                            created_time: new Date().toISOString(),
                            from: { name: selectedPage?.page_name || '' },
                            like_count: 0,
                            user_likes: false,
                        }],
                    }
                }));
            }
            // Optimistic: increment comment_count in commentsData
            if (postId) {
                setCommentsData(prev => ({
                    ...prev,
                    [postId]: {
                        ...prev[postId],
                        comments: (prev[postId]?.comments || []).map(c =>
                            c.id === commentId ? { ...c, comment_count: (c.comment_count || 0) + 1 } : c
                        ),
                    }
                }));
            }
            setSnackbar({ open: true, message: t('facebookContent.messages.replySent'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.replySendFailed'), severity: 'error' });
        } finally {
            setReplyLoading(prev => ({ ...prev, [commentId]: false }));
        }
    };

    const handleHideComment = async (commentId, currentlyHidden, postId) => {
        try {
            await api.hidePortalFbComment(selectedPageId, commentId, !currentlyHidden);
            // Optimistic: toggle is_hidden locally
            if (postId) {
                setCommentsData(prev => ({
                    ...prev,
                    [postId]: {
                        ...prev[postId],
                        comments: (prev[postId]?.comments || []).map(c =>
                            c.id === commentId ? { ...c, is_hidden: !currentlyHidden } : c
                        ),
                    }
                }));
            }
            setSnackbar({ open: true, message: currentlyHidden ? t('facebookContent.messages.commentShown') : t('facebookContent.messages.commentHidden'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.commentStateFailed'), severity: 'error' });
        }
    };

    const handleDeleteComment = async () => {
        if (!deleteTarget || !selectedPageId) return;
        try {
            setDeleteLoading(true);
            const commentId = typeof deleteTarget === 'object' ? deleteTarget.id : deleteTarget;
            const postId = typeof deleteTarget === 'object' ? deleteTarget.postId : null;
            await api.deletePortalFbComment(selectedPageId, commentId);
            // Optimistic: remove comment locally
            if (postId) {
                setCommentsData(prev => ({
                    ...prev,
                    [postId]: {
                        ...prev[postId],
                        comments: (prev[postId]?.comments || []).filter(c => c.id !== commentId),
                    }
                }));
            }
            setSnackbar({ open: true, message: t('facebookContent.messages.commentDeleted'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.commentDeleteFailed'), severity: 'error' });
        } finally {
            setDeleteLoading(false);
            setDeleteTarget(null);
            setDeleteType('');
        }
    };

    const handleLikeComment = async (comment, postId, parentCommentId = null) => {
        const newLiked = !comment.user_likes;
        // Optimistic: update locally first
        if (parentCommentId) {
            setRepliesData(prev => ({
                ...prev,
                [parentCommentId]: {
                    ...prev[parentCommentId],
                    replies: (prev[parentCommentId]?.replies || []).map(r =>
                        r.id === comment.id ? { ...r, user_likes: newLiked, like_count: (r.like_count || 0) + (newLiked ? 1 : -1) } : r
                    ),
                }
            }));
        } else {
            setCommentsData(prev => ({
                ...prev,
                [postId]: {
                    ...prev[postId],
                    comments: (prev[postId]?.comments || []).map(c =>
                        c.id === comment.id ? { ...c, user_likes: newLiked, like_count: (c.like_count || 0) + (newLiked ? 1 : -1) } : c
                    ),
                }
            }));
        }
        try {
            if (comment.user_likes) {
                await api.unlikePortalFbComment(selectedPageId, comment.id);
            } else {
                await api.likePortalFbComment(selectedPageId, comment.id);
            }
        } catch (err) {
            // Revert optimistic update on error
            if (parentCommentId) {
                setRepliesData(prev => ({
                    ...prev,
                    [parentCommentId]: {
                        ...prev[parentCommentId],
                        replies: (prev[parentCommentId]?.replies || []).map(r =>
                            r.id === comment.id ? { ...r, user_likes: comment.user_likes, like_count: comment.like_count || 0 } : r
                        ),
                    }
                }));
            } else {
                setCommentsData(prev => ({
                    ...prev,
                    [postId]: {
                        ...prev[postId],
                        comments: (prev[postId]?.comments || []).map(c =>
                            c.id === comment.id ? { ...c, user_likes: comment.user_likes, like_count: comment.like_count || 0 } : c
                        ),
                    }
                }));
            }
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.likeUpdateFailed'), severity: 'error' });
        }
    };

    const handleLikePost = async (post) => {
        const isLiked = likedPosts[post.id];
        // Optimistic update
        setLikedPosts(prev => ({ ...prev, [post.id]: !isLiked }));
        setPosts(prev => prev.map(p =>
            p.id === post.id ? {
                ...p,
                likes: {
                    ...p.likes,
                    summary: {
                        ...p.likes?.summary,
                        total_count: (p.likes?.summary?.total_count || 0) + (isLiked ? -1 : 1),
                    }
                }
            } : p
        ));
        try {
            if (isLiked) {
                await api.unlikePortalFbPost(selectedPageId, post.id);
            } else {
                await api.likePortalFbPost(selectedPageId, post.id);
            }
        } catch (err) {
            // Revert on error
            setLikedPosts(prev => ({ ...prev, [post.id]: isLiked }));
            setPosts(prev => prev.map(p =>
                p.id === post.id ? {
                    ...p,
                    likes: {
                        ...p.likes,
                        summary: {
                            ...p.likes?.summary,
                            total_count: (p.likes?.summary?.total_count || 0) + (isLiked ? 1 : -1),
                        }
                    }
                } : p
            ));
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.likeUpdateFailed'), severity: 'error' });
        }
    };

    const handleCommentOnPost = async (postId) => {
        const message = commentTexts[postId];
        if (!message?.trim() || !selectedPageId) return;
        try {
            setCommentSubmitting(prev => ({ ...prev, [postId]: true }));
            const result = await api.commentOnPortalFbPost(selectedPageId, postId, message);
            setCommentTexts(prev => ({ ...prev, [postId]: '' }));
            // Optimistic: add comment locally
            if (result?.id) {
                setCommentsData(prev => ({
                    ...prev,
                    [postId]: {
                        ...prev[postId],
                        comments: [...(prev[postId]?.comments || []), {
                            id: result.id,
                            message: message,
                            created_time: new Date().toISOString(),
                            from: { name: selectedPage?.page_name || '' },
                            like_count: 0,
                            user_likes: false,
                            comment_count: 0,
                        }],
                    }
                }));
            }
            // Optimistic: increment post comment count
            setPosts(prev => prev.map(p =>
                p.id === postId ? {
                    ...p,
                    comments: {
                        ...p.comments,
                        summary: {
                            ...p.comments?.summary,
                            total_count: (p.comments?.summary?.total_count || 0) + 1,
                        }
                    }
                } : p
            ));
            setSnackbar({ open: true, message: t('facebookContent.messages.replySent'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.replySendFailed'), severity: 'error' });
        } finally {
            setCommentSubmitting(prev => ({ ...prev, [postId]: false }));
        }
    };

    const handleStartEdit = (post) => {
        setEditingPostId(post.id);
        setEditMessage(post.message || '');
    };

    const handleSaveEdit = async () => {
        if (!editingPostId || !selectedPageId) return;
        try {
            setEditLoading(true);
            await api.editPortalFbPost(selectedPageId, editingPostId, { message: editMessage });
            setEditingPostId(null);
            setEditMessage('');
            loadPosts();
            setSnackbar({ open: true, message: t('facebookContent.messages.postEdited'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.postEditFailed'), severity: 'error' });
        } finally {
            setEditLoading(false);
        }
    };

    const handleDeletePost = async () => {
        if (!deleteTarget || !selectedPageId) return;
        try {
            setDeleteLoading(true);
            await api.deletePortalFbPost(selectedPageId, deleteTarget);
            setPosts(prev => prev.filter(p => p.id !== deleteTarget));
            setSnackbar({ open: true, message: t('facebookContent.messages.postDeleted'), severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.postDeleteFailed'), severity: 'error' });
        } finally {
            setDeleteLoading(false);
            setDeleteTarget(null);
            setDeleteType('');
        }
    };

    const openProductDialog = post => {
        setProductDraft(buildFacebookPostProductDraft(
            post,
            t('facebookContent.productFromPostFallbackName'),
        ));
        setProductDialogOpen(true);
    };

    const handleCreateProductFromPost = async () => {
        if (!productDraft?.name?.trim()) return;
        try {
            setProductSaving(true);
            await api.createPortalMessengerBotProduct({
                ...productDraft,
                price: Number(productDraft.price) || 0,
            });
            setProductDialogOpen(false);
            setProductDraft(null);
            setSnackbar({
                open: true,
                message: t('facebookContent.messages.productCreatedFromPost'),
                severity: 'success',
            });
        } catch (err) {
            setSnackbar({
                open: true,
                message: err.message || t('facebookContent.messages.productCreateFromPostFailed'),
                severity: 'error',
            });
        } finally {
            setProductSaving(false);
        }
    };

    const formatTime = (timestamp) => formatFacebookContentTime(timestamp, locale);

    const openAutoDialog = async (post) => {
        setAutoTargetPost(post);
        setAutoForm({
            name: `${t('facebookContent.autoRuleNamePrefix')} - ${(post.message || t('facebookContent.defaultPostName')).substring(0, 30)}`,
            match_pattern: '', response_text: '', dm_text: '',
            response_action: 'comment', cooldown_seconds: 300, trigger_on: 'comment',
            auto_like: false,
        });
        setAutoDialogOpen(true);
        fetchAutoRules(post.id);
    };

    const fetchAutoRules = async (postId) => {
        try {
            setAutoRulesLoading(true);
            const allRules = await api.getPortalAutomationRules({ rule_type: 'comment_reply' });
            const filtered = (allRules || []).filter(r =>
                r.target_post_id === postId ||
                (r.target_page_id == selectedPageId && !r.target_post_id)
            );
            setAutoRules(filtered);
        } catch {
            setAutoRules([]);
        } finally {
            setAutoRulesLoading(false);
        }
    };

    const handleCreateAutoRule = async () => {
        if (!autoTargetPost) return;
        try {
            setAutoSaving(true);
            await api.createPortalAutomationRule({
                name: autoForm.name,
                rule_type: 'comment_reply',
                channel: 'facebook',
                target_page_id: selectedPageId,
                target_post_id: autoTargetPost.id,
                match_type: autoForm.match_pattern ? 'contains' : null,
                match_pattern: autoForm.match_pattern || null,
                response_text: autoForm.response_text || null,
                dm_text: autoForm.dm_text || null,
                response_action: autoForm.response_action,
                cooldown_seconds: autoForm.cooldown_seconds,
                trigger_on: autoForm.trigger_on,
                auto_like: autoForm.auto_like,
                is_active: true,
                priority: 100,
            });
            setSnackbar({ open: true, message: t('facebookContent.messages.ruleCreated'), severity: 'success' });
            fetchAutoRules(autoTargetPost.id);
            setAutoForm(prev => ({ ...prev, name: '', match_pattern: '', response_text: '', dm_text: '' }));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || t('facebookContent.messages.ruleCreateFailed'), severity: 'error' });
        } finally {
            setAutoSaving(false);
        }
    };

    const handleToggleAutoRule = async (ruleId) => {
        try {
            await api.togglePortalAutomationRule(ruleId);
            if (autoTargetPost) fetchAutoRules(autoTargetPost.id);
        } catch {
            setSnackbar({ open: true, message: t('facebookContent.messages.ruleToggleFailed'), severity: 'error' });
        }
    };

    if (pagesLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: embedded ? 0 : { xs: 1.5, md: 3 } }}>
            {!embedded && (
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3, gap: { xs: 1, md: 0 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <FacebookIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                        <Box>
                            <Typography variant="h4" component="h1" fontWeight={700}>{t('facebookContent.tenantTitle')}</Typography>
                            <Typography variant="body2" color="text.secondary">{t('facebookContent.tenantSubtitle')}</Typography>
                        </Box>
                    </Box>
                    <Button startIcon={<RefreshIcon />} onClick={() => { loadPages(); if (selectedPageId) loadPosts(); }} variant="outlined">
                        {t('common.refresh')}
                    </Button>
                </Box>
            )}

            {pagesError && <Alert severity="error" sx={{ mb: 2 }}>{pagesError}</Alert>}

            <Paper sx={{ p: 2, mb: 3 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>{t('facebookContent.selectPage')}</InputLabel>
                    <Select
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        label={t('facebookContent.selectPage')}
                    >
                        {pages.length === 0 ? (
                            <MenuItem value="" disabled>{t('facebookContent.noTenantPages')}</MenuItem>
                        ) : (
                            pages.map(page => (
                                <MenuItem key={page.id} value={page.id}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <FacebookIcon sx={{ color: '#1877f2', fontSize: 18 }} />
                                        <span>{page.page_name || page.page_id}</span>
                                        {!page.is_active && <Chip label={t('facebookContent.disabled')} size="small" color="error" />}
                                    </Box>
                                </MenuItem>
                            ))
                        )}
                    </Select>
                </FormControl>
            </Paper>

            {selectedPageId && (
                <Box sx={{ maxWidth: 680, mx: 'auto' }}>
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                            {t('facebookContent.newPost', { page: selectedPage?.page_name || selectedPage?.page_id })}
                        </Typography>
                        <FacebookPostComposerTabs value={composerTab} onChange={setComposerTab} t={t} />

                        {(composerTab === 'text' || composerTab === 'link' || composerTab === 'schedule') && (
                            <TextField
                                fullWidth multiline rows={3} label={t('facebookContent.postText')}
                                value={composerMessage}
                                onChange={(e) => setComposerMessage(e.target.value)}
                                placeholder={t('facebookContent.postPlaceholder')} sx={{ mb: 2 }}
                            />
                        )}

                        {composerTab === 'photo' && (
                            <>
                                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                                    <Button variant={composerPhotoFile ? 'contained' : 'outlined'} component="label" role={undefined} startIcon={<UploadIcon />}>
                                        {composerPhotoFile ? composerPhotoFile.name : t('facebookContent.uploadFile')}
                                        <input type="file" hidden accept="image/*" onChange={(e) => { setComposerPhotoFile(e.target.files[0] || null); setComposerPhotoUrl(''); }} />
                                    </Button>
                                    <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>{t('facebookContent.or')}</Typography>
                                    <TextField
                                        size="small" label={t('facebookContent.imageUrl')}
                                        value={composerPhotoUrl}
                                        onChange={(e) => { setComposerPhotoUrl(e.target.value); setComposerPhotoFile(null); }}
                                        placeholder="https://example.com/photo.jpg" sx={{ flex: 1 }}
                                        disabled={!!composerPhotoFile}
                                    />
                                </Box>
                                <TextField fullWidth multiline rows={2} label={t('facebookContent.imageCaption')} value={composerCaption} onChange={(e) => setComposerCaption(e.target.value)} placeholder={t('facebookContent.imageCaptionPlaceholder')} sx={{ mb: 2 }} />
                            </>
                        )}

                        {composerTab === 'link' && (
                            <TextField fullWidth label={t('facebookContent.link')} value={composerLink} onChange={(e) => setComposerLink(e.target.value)} placeholder="https://example.com" sx={{ mb: 2 }} />
                        )}

                        {composerTab === 'schedule' && (
                            <TextField fullWidth type="datetime-local" label={t('facebookContent.scheduleTime')} value={composerScheduleTime} onChange={(e) => setComposerScheduleTime(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ mb: 2 }} />
                        )}

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="contained" onClick={handlePublish}
                                disabled={publishing || !canPublish()}
                                startIcon={publishing ? <CircularProgress size={18} /> : <SendIcon />}
                                sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                            >
                                {publishing ? t('facebookContent.publishing') : (composerTab === 'schedule' ? t('facebookContent.schedulePost') : t('facebookContent.publishPost'))}
                            </Button>
                        </Box>
                    </Paper>

                    <Typography variant="h6" component="h2" fontWeight={600} sx={{ mb: 2 }}>{t('facebookContent.posts')}</Typography>

                    {postsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                    ) : postsError ? (
                        <Alert severity="error">{postsError}</Alert>
                    ) : posts.length === 0 ? (
                        <Paper sx={{ p: 4, textAlign: 'center' }}>
                            <Typography color="text.secondary">{t('facebookContent.noPosts')}</Typography>
                        </Paper>
                    ) : (
                        <>
                            {posts.map(post => (
                                <Card key={post.id} sx={{ mb: 2 }}>
                                    <CardContent>
                                        {editingPostId === post.id ? (
                                            <Box>
                                                <TextField fullWidth multiline rows={3} value={editMessage} onChange={(e) => setEditMessage(e.target.value)} />
                                                <Box sx={{ mt: 1, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                                    <Button size="small" onClick={() => setEditingPostId(null)}>{t('common.cancel')}</Button>
                                                    <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={editLoading}>
                                                        {editLoading ? <CircularProgress size={16} /> : t('common.save')}
                                                    </Button>
                                                </Box>
                                            </Box>
                                        ) : (
                                            <FacebookPostMessage
                                                expanded={!!expandedPosts[post.id]}
                                                hasPicture={!!post.full_picture}
                                                message={post.message}
                                                onToggle={() => setExpandedPosts(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
                                                t={t}
                                            />
                                        )}

                                        {post.full_picture && (
                                            <CardMedia component="img" image={post.full_picture} sx={{ maxHeight: 300, borderRadius: 1, mt: 1, objectFit: 'cover' }} alt="Post image" />
                                        )}

                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                                            {post.likes?.summary?.total_count !== undefined && (
                                                <Chip icon={<LikeIcon fontSize="small" />} label={post.likes.summary.total_count} size="small" variant="outlined" sx={{ height: 24 }} />
                                            )}
                                            {post.comments?.summary?.total_count !== undefined && (
                                                <Chip icon={<CommentIcon fontSize="small" />} label={post.comments.summary.total_count} size="small" variant="outlined" sx={{ height: 24 }} />
                                            )}
                                            {post.shares?.count !== undefined && (
                                                <Chip icon={<ShareIcon fontSize="small" />} label={post.shares.count} size="small" variant="outlined" sx={{ height: 24 }} />
                                            )}
                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                                {formatTime(post.created_time)}
                                            </Typography>
                                            {post.permalink_url && (
                                                <IconButton size="small" aria-label="Open post on Facebook" component="a" href={post.permalink_url} target="_blank" rel="noopener">
                                                    <OpenInNewIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    </CardContent>

                                    <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 1, gap: 1, flexWrap: 'wrap' }}>
                                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                            <Button size="small" startIcon={<LikeIcon />} onClick={() => handleLikePost(post)} color={likedPosts[post.id] ? 'primary' : 'inherit'}>
                                                {likedPosts[post.id] ? t('facebookContent.unlike') : t('facebookContent.like')}
                                            </Button>
                                            <Button size="small" startIcon={<CommentIcon />} onClick={() => toggleComments(post.id)}>
                                                {expandedComments[post.id] ? t('facebookContent.hideComments') : t('facebookContent.comments')}
                                                {expandedComments[post.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </Button>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', ml: 'auto' }}>
                                            <Tooltip title={t('facebookContent.convertToProduct')}>
                                                <IconButton
                                                    size="small"
                                                    color="success"
                                                    aria-label={t('facebookContent.convertToProduct')}
                                                    onClick={() => openProductDialog(post)}
                                                >
                                                    <ProductIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title={t('facebookContent.automateComments')}>
                                                <IconButton size="small" color="primary" aria-label={t('facebookContent.automateComments')} onClick={() => openAutoDialog(post)}><BoltIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title={t('facebookContent.edit')}>
                                                <IconButton size="small" aria-label={t('facebookContent.edit')} onClick={() => handleStartEdit(post)}><EditIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title={t('facebookContent.delete')}>
                                                <IconButton size="small" color="error" aria-label={t('facebookContent.delete')} onClick={() => { setDeleteTarget(post.id); setDeleteType('post'); }}><DeleteIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                        </Box>
                                    </CardActions>

                                    <Collapse in={!!expandedComments[post.id]} timeout="auto" unmountOnExit>
                                        <Divider />
                                        <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
                                            {commentsLoading[post.id] ? (
                                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                                            ) : (
                                                <>
                                                    {(commentsData[post.id]?.comments || []).map(comment => {
                                                        const repliesState = repliesData[comment.id] || { replies: [], paging: null };
                                                        const replies = repliesState.replies || [];
                                                        const replyCount = comment.comments?.summary?.total_count ?? comment.comment_count ?? replies.length;
                                                        return (
                                                        <Box key={comment.id} sx={{ display: 'flex', gap: 1, mb: 2, p: 1, bgcolor: comment.is_hidden ? 'action.hover' : 'background.paper', borderRadius: 1, opacity: comment.is_hidden ? 0.6 : 1 }}>
                                                            <Avatar src={comment.from?.picture?.data?.url} sx={{ width: 32, height: 32 }}>
                                                                {comment.from?.name?.charAt(0)}
                                                            </Avatar>
                                                            <Box sx={{ flex: 1 }}>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                    <Typography variant="subtitle2">{comment.from?.name || t('facebookContent.user')}</Typography>
                                                                    {comment.is_hidden && <Chip label={t('facebookContent.hidden')} size="small" color="error" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
                                                                </Box>
                                                                <Typography variant="body2">{comment.message}</Typography>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                                    <Typography variant="caption" color="text.secondary">{formatTime(comment.created_time)}</Typography>
                                                                    <Typography variant="caption" color="text.secondary">• 👍 {comment.like_count || 0}</Typography>
                                                                    {replyCount > 0 && <Typography variant="caption" color="text.secondary">• {t('facebookContent.replies', { count: replyCount })}</Typography>}
                                                                </Box>
                                                                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                                                                    <Button size="small" variant="text" onClick={() => handleLikeComment(comment, post.id)}>
                                                                        {comment.user_likes ? t('facebookContent.unlike') : t('facebookContent.like')}
                                                                    </Button>
                                                                    <Button size="small" variant="text" onClick={() => handleHideComment(comment.id, comment.is_hidden, post.id)}>
                                                                        {comment.is_hidden ? t('facebookContent.show') : t('facebookContent.hide')}
                                                                    </Button>
                                                                    <Button size="small" variant="text" color="error" onClick={() => { setDeleteTarget({ id: comment.id, postId: post.id }); setDeleteType('comment'); }}>
                                                                        {t('facebookContent.delete')}
                                                                    </Button>
                                                                    <Button size="small" variant="text" onClick={() => loadReplies(comment.id)} disabled={repliesLoading[comment.id]}>
                                                                        {repliesLoading[comment.id] ? t('facebookContent.loading') : replies.length > 0 ? t('facebookContent.refreshReplies') : t('facebookContent.showReplies')}
                                                                    </Button>
                                                                </Box>
                                                                {replies.length > 0 && (
                                                                    <Box sx={{ mt: 1, pr: 1.5, borderRight: '2px solid', borderColor: 'divider' }}>
                                                                        {replies.map(reply => (
                                                                            <Box key={reply.id} sx={{ display: 'flex', gap: 1, mb: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                                                                                <Avatar src={reply.from?.picture?.data?.url} sx={{ width: 26, height: 26 }}>
                                                                                    {reply.from?.name?.charAt(0)}
                                                                                </Avatar>
                                                                                <Box sx={{ flex: 1 }}>
                                                                                    <Typography variant="caption" fontWeight={700}>{reply.from?.name || t('facebookContent.user')}</Typography>
                                                                                    <Typography variant="body2">{reply.message}</Typography>
                                                                                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                                                                                        <Typography variant="caption" color="text.secondary">{formatTime(reply.created_time)}</Typography>
                                                                                        <Typography variant="caption" color="text.secondary">• 👍 {reply.like_count || 0}</Typography>
                                                                                        <Button size="small" onClick={() => handleLikeComment(reply, post.id, comment.id)}>
                                                                                            {reply.user_likes ? t('facebookContent.unlike') : t('facebookContent.like')}
                                                                                        </Button>
                                                                                    </Box>
                                                                                </Box>
                                                                            </Box>
                                                                        ))}
                                                                        {repliesState.paging?.next && (
                                                                            <Button size="small" variant="outlined" onClick={() => loadReplies(comment.id, true)} disabled={repliesLoading[comment.id]}>
                                                                                {t('facebookContent.moreReplies')}
                                                                            </Button>
                                                                        )}
                                                                    </Box>
                                                                )}
                                                                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                                    <TextField
                                                                        size="small" placeholder={t('facebookContent.replyPlaceholder')}
                                                                        value={replyTexts[comment.id] || ''}
                                                                        onChange={(e) => setReplyTexts(prev => ({ ...prev, [comment.id]: e.target.value }))}
                                                                        sx={{ flex: 1 }}
                                                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(comment.id, post.id); } }}
                                                                    />
                                                                    <IconButton size="small" color="primary" aria-label={t('common.send')} onClick={() => handleReply(comment.id, post.id)} disabled={replyLoading[comment.id]}>
                                                                        {replyLoading[comment.id] ? <CircularProgress size={16} /> : <SendIcon />}
                                                                    </IconButton>
                                                                </Box>
                                                            </Box>
                                                        </Box>
                                                    );
                                                    })}
                                                    {(commentsData[post.id]?.comments || []).length === 0 && (
                                                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>{t('facebookContent.noComments')}</Typography>
                                                    )}
                                                    {commentsData[post.id]?.paging?.next && (
                                                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                                                            <Button size="small" variant="outlined" onClick={() => loadComments(post.id, true)} disabled={commentsLoading[post.id]}>
                                                                {t('facebookContent.moreComments')}
                                                            </Button>
                                                        </Box>
                                                    )}
                                                    {/* Add new comment on post */}
                                                    <Box sx={{ display: 'flex', gap: 1, mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                                        <TextField
                                                            size="small"
                                                            placeholder={t('facebookContent.commentPlaceholder') || t('facebookContent.replyPlaceholder')}
                                                            value={commentTexts[post.id] || ''}
                                                            onChange={(e) => setCommentTexts(prev => ({ ...prev, [post.id]: e.target.value }))}
                                                            sx={{ flex: 1 }}
                                                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommentOnPost(post.id); } }}
                                                        />
                                                        <IconButton size="small" color="primary" aria-label={t('common.send')} onClick={() => handleCommentOnPost(post.id)} disabled={commentSubmitting[post.id]}>
                                                            {commentSubmitting[post.id] ? <CircularProgress size={16} /> : <SendIcon />}
                                                        </IconButton>
                                                    </Box>
                                                </>
                                            )}
                                        </Box>
                                    </Collapse>
                                </Card>
                            ))}

                            {postsPaging?.next && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                    <Button variant="outlined" onClick={() => loadPosts(true, postsPaging?.cursors?.after)} disabled={loadingMore}>
                                        {loadingMore ? <CircularProgress size={20} /> : t('facebookContent.loadMore')}
                                    </Button>
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}

            <FacebookPostProductDialog
                draft={productDraft}
                onChange={setProductDraft}
                onClose={() => {
                    setProductDialogOpen(false);
                    setProductDraft(null);
                }}
                onSubmit={handleCreateProductFromPost}
                open={productDialogOpen}
                saving={productSaving}
                t={t}
            />

            <FacebookDeleteDialog
                deleteType={deleteType}
                deleting={deleteLoading}
                onCancel={() => { setDeleteTarget(null); setDeleteType(''); }}
                onDeleteComment={handleDeleteComment}
                onDeletePost={handleDeletePost}
                open={!!deleteTarget}
                t={t}
            />

            <FacebookContentSnackbar
                snackbar={snackbar}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
            />

            <Dialog open={autoDialogOpen} onClose={() => setAutoDialogOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { 'aria-label': t('facebookContent.commentAutomation') } }}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BoltIcon color="primary" />
                    {t('facebookContent.commentAutomation')}
                </DialogTitle>
                <DialogContent dividers>
                    {autoTargetPost && (
                        <Alert severity="info" sx={{ mb: 2, fontSize: '0.85rem' }}>
                            {t('facebookContent.post')}: "{(autoTargetPost.message || t('facebookContent.noText')).substring(0, 80)}{(autoTargetPost.message || '').length > 80 ? '...' : ''}"
                        </Alert>
                    )}

                    {autoRulesLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                    ) : autoRules.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('facebookContent.currentRules')}</Typography>
                            {autoRules.map(rule => (
                                <Box key={rule.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, mb: 0.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                                    <Switch checked={!!rule.is_active} onChange={() => handleToggleAutoRule(rule.id)} size="small" color="success" />
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2" fontWeight="bold">{rule.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {rule.trigger_on === 'reaction' ? t('facebookContent.reactions') : rule.trigger_on === 'both' ? `${t('facebookContent.commentsOnly')}+${t('facebookContent.reactions')}` : t('facebookContent.commentsOnly')}
                                            {rule.match_pattern ? ` • ${t('facebookContent.keywordsLabel')}: ${rule.match_pattern}` : ''}
                                            {' • '}
                                            {rule.response_action === 'comment' ? t('facebookContent.publicReply') : rule.response_action === 'dm' ? t('facebookContent.privateMessage') : t('facebookContent.both')}
                                            {' • '}
                                            {t('facebookContent.runs', { count: rule.trigger_count || 0 })}
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}

                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('facebookContent.newRule')}</Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField label={t('facebookContent.ruleName')} value={autoForm.name} onChange={e => setAutoForm(p => ({ ...p, name: e.target.value }))} fullWidth size="small" />
                        <TextField label={t('facebookContent.keywords')} value={autoForm.match_pattern} onChange={e => setAutoForm(p => ({ ...p, match_pattern: e.target.value }))} fullWidth size="small" placeholder={t('facebookContent.keywordsPlaceholder')} />

                        <Typography variant="caption" color="primary">{t('facebookContent.ruleTrigger')}</Typography>
                        <RadioGroup row value={autoForm.trigger_on} onChange={e => {
                            const val = e.target.value;
                            setAutoForm(p => ({ ...p, trigger_on: val, response_action: val === 'reaction' ? 'dm' : p.response_action }));
                        }}>
                            <FormControlLabel value="comment" control={<Radio size="small" />} label={t('facebookContent.commentsOnly')} />
                            <FormControlLabel value="reaction" control={<Radio size="small" />} label={t('facebookContent.reactions')} />
                            <FormControlLabel value="both" control={<Radio size="small" />} label={t('facebookContent.both')} />
                        </RadioGroup>

                        <Typography variant="caption" color="primary">{t('facebookContent.responseType')}</Typography>
                        <RadioGroup row value={autoForm.response_action} onChange={e => setAutoForm(p => ({ ...p, response_action: e.target.value }))}>
                            <FormControlLabel value="comment" control={<Radio size="small" />} label={t('facebookContent.publicReply')} disabled={autoForm.trigger_on === 'reaction'} />
                            <FormControlLabel value="dm" control={<Radio size="small" />} label={t('facebookContent.privateMessage')} />
                            <FormControlLabel value="both" control={<Radio size="small" />} label={t('facebookContent.both')} disabled={autoForm.trigger_on === 'reaction'} />
                        </RadioGroup>

                        {(autoForm.trigger_on === 'comment' || autoForm.trigger_on === 'both') && (
                            <FormControlLabel
                                control={<Switch checked={autoForm.auto_like} onChange={e => setAutoForm(p => ({ ...p, auto_like: e.target.checked }))} color="primary" size="small" />}
                                label={t('facebookContent.autoLike')}
                            />
                        )}

                        {(autoForm.response_action === 'comment' || autoForm.response_action === 'both') && (
                            <TextField label={t('facebookContent.publicReplyText')} value={autoForm.response_text} onChange={e => setAutoForm(p => ({ ...p, response_text: e.target.value }))} multiline rows={2} fullWidth size="small" placeholder={t('facebookContent.publicReplyPlaceholder')} />
                        )}
                        {(autoForm.response_action === 'dm' || autoForm.response_action === 'both') && (
                            <TextField label={t('facebookContent.privateMessageText')} value={autoForm.dm_text} onChange={e => setAutoForm(p => ({ ...p, dm_text: e.target.value }))} multiline rows={2} fullWidth size="small" placeholder={t('facebookContent.privateMessagePlaceholder')} />
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAutoDialogOpen(false)}>{t('common.close')}</Button>
                    <Button
                        variant="contained"
                        onClick={handleCreateAutoRule}
                        disabled={autoSaving || !autoForm.name || (!autoForm.response_text && !autoForm.dm_text)}
                        startIcon={autoSaving ? <CircularProgress size={16} color="inherit" /> : <BoltIcon />}
                    >
                        {autoSaving ? t('common.saving') : t('facebookContent.createRule')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantContentManager;
