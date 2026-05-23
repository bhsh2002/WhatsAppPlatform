import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, TextField, Select, MenuItem, FormControl,
    InputLabel, CircularProgress, Alert, Snackbar, Chip, Avatar, IconButton,
    Card, CardContent, CardMedia, CardActions, Collapse, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider, Grid, Tab, Tabs, Tooltip,
    RadioGroup, Radio, FormControlLabel, Switch
} from '@mui/material';
import {
    Facebook as FacebookIcon, Send as SendIcon, Delete as DeleteIcon,
    Edit as EditIcon, Visibility as ViewIcon, VisibilityOff as HideIcon,
    Link as LinkIcon, Image as ImageIcon, Schedule as ScheduleIcon,
    TextSnippet as TextIcon, Refresh as RefreshIcon, ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon, ChatBubble as CommentIcon,
    OpenInNew as OpenInNewIcon, CloudUpload as UploadIcon,
    SmartToy as AutomationIcon, Bolt as BoltIcon, SettingsEthernet as WebhookIcon,
    ThumbUp as LikeIcon, Share as ShareIcon
} from '@mui/icons-material';
import api from '../../api';
import { useLanguage } from '../../context/LanguageContext';

const POST_TABS = [
    { value: 'text', label: 'نص', icon: <TextIcon /> },
    { value: 'photo', label: 'صورة', icon: <ImageIcon /> },
    { value: 'link', label: 'رابط', icon: <LinkIcon /> },
    { value: 'schedule', label: 'جدولة', icon: <ScheduleIcon /> },
];

const POST_TRUNCATE_LENGTH = 200;

const FacebookPageManager = () => {
    const { locale, t } = useLanguage();
    const [allPages, setAllPages] = useState([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [pagesLoading, setPagesLoading] = useState(true);
    const [pagesError, setPagesError] = useState('');
    const [webhookDiagnostics, setWebhookDiagnostics] = useState(null);
    const [webhookLoading, setWebhookLoading] = useState(false);
    const [webhookSetupLoading, setWebhookSetupLoading] = useState(false);
    const [webhookError, setWebhookError] = useState('');

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

    const [editingPostId, setEditingPostId] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteType, setDeleteType] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Automation quick-setup
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

    const selectedPage = allPages.find(p => p.id === selectedPageId);

    const loadAllPages = useCallback(async () => {
        try {
            setPagesLoading(true);
            setPagesError('');
            const data = await api.getFbAllPages();
            setAllPages(Array.isArray(data) ? data : []);
            if (data.length > 0 && !selectedPageId) {
                setSelectedPageId(data[0].id);
            }
        } catch (err) {
            setPagesError(err.message || 'فشل جلب صفحات فيسبوك');
            setAllPages([]);
        } finally {
            setPagesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAllPages();
    }, [loadAllPages]);

    const loadWebhookDiagnostics = useCallback(async () => {
        try {
            setWebhookLoading(true);
            setWebhookError('');
            const data = await api.getFacebookWebhookDiagnostic();
            setWebhookDiagnostics(data);
        } catch (err) {
            setWebhookError(err.message || 'فشل فحص Webhook فيسبوك');
            setWebhookDiagnostics(null);
        } finally {
            setWebhookLoading(false);
        }
    }, []);

    useEffect(() => {
        loadWebhookDiagnostics();
    }, [loadWebhookDiagnostics]);

    const loadPosts = useCallback(async (append = false) => {
        if (!selectedPageId) return;
        try {
            if (!append) setPostsLoading(true);
            else setLoadingMore(true);
            setPostsError('');
            const params = {};
            if (append && postsPaging?.cursors?.after) {
                params.after = postsPaging.cursors.after;
            }
            const data = await api.getFacebookPosts(selectedPageId, params);
            if (append) {
                setPosts(prev => [...prev, ...(data.posts || [])]);
            } else {
                setPosts(data.posts || []);
            }
            setPostsPaging(data.paging || null);
        } catch (err) {
            setPostsError(err.message || 'فشل جلب المنشورات');
        } finally {
            setPostsLoading(false);
            setLoadingMore(false);
        }
    }, [selectedPageId, postsPaging]);

    useEffect(() => {
        if (selectedPageId) {
            setPosts([]);
            setPostsPaging(null);
            setExpandedComments({});
            setCommentsData({});
            setRepliesData({});
            loadPosts();
        }
    }, [selectedPageId]);

    const handlePublish = async () => {
        if (!selectedPageId) return;
        try {
            setPublishing(true);
            if (composerTab === 'photo' && composerPhotoFile) {
                const formData = new FormData();
                formData.append('source', composerPhotoFile);
                if (composerCaption) formData.append('caption', composerCaption);
                await api.createFacebookPhotoPostFile(selectedPageId, formData);
            } else if (composerTab === 'photo' && composerPhotoUrl) {
                await api.createFacebookPhotoPostUrl(selectedPageId, {
                    url: composerPhotoUrl,
                    caption: composerCaption || undefined,
                });
            } else if (composerTab === 'link') {
                await api.createFacebookPost(selectedPageId, {
                    message: composerMessage || undefined,
                    link: composerLink || undefined,
                });
            } else if (composerTab === 'schedule') {
                await api.createFacebookPost(selectedPageId, {
                    message: composerMessage,
                    published: false,
                    scheduled_publish_time: composerScheduleTime,
                });
            } else {
                if (!composerMessage.trim()) return;
                await api.createFacebookPost(selectedPageId, { message: composerMessage });
            }
            setComposerMessage('');
            setComposerLink('');
            setComposerPhotoUrl('');
            setComposerCaption('');
            setComposerPhotoFile(null);
            setComposerScheduleTime('');
            setSnackbar({ open: true, message: 'تم نشر المنشور بنجاح', severity: 'success' });
            loadPosts();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل نشر المنشور', severity: 'error' });
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
            const data = await api.getFacebookComments(selectedPageId, postId, params);
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
            setSnackbar({ open: true, message: err.message || 'فشل جلب التعليقات', severity: 'error' });
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
            const data = await api.getFacebookCommentReplies(selectedPageId, commentId, params);
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
            setSnackbar({ open: true, message: err.message || 'فشل جلب الردود', severity: 'error' });
        } finally {
            setRepliesLoading(prev => ({ ...prev, [commentId]: false }));
        }
    };

    const toggleComments = (postId) => {
        if (expandedComments[postId]) {
            setExpandedComments(prev => ({ ...prev, [postId]: false }));
        } else {
            setExpandedComments(prev => ({ ...prev, [postId]: true }));
            if (!commentsData[postId]) {
                loadComments(postId);
            }
        }
    };

    const handleReply = async (commentId, postId) => {
        const message = replyTexts[commentId];
        if (!message?.trim() || !selectedPageId) return;
        try {
            setReplyLoading(prev => ({ ...prev, [commentId]: true }));
            await api.replyToFacebookComment(selectedPageId, commentId, message);
            setReplyTexts(prev => ({ ...prev, [commentId]: '' }));
            if (postId) loadComments(postId);
            loadReplies(commentId);
            setSnackbar({ open: true, message: 'تم إرسال الرد', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إرسال الرد', severity: 'error' });
        } finally {
            setReplyLoading(prev => ({ ...prev, [commentId]: false }));
        }
    };

    const handleHideComment = async (commentId, currentlyHidden, postId) => {
        try {
            await api.hideFacebookComment(selectedPageId, commentId, !currentlyHidden);
            if (postId) loadComments(postId);
            setSnackbar({ open: true, message: currentlyHidden ? 'تم إظهار التعليق' : 'تم إخفاء التعليق', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحديث حالة التعليق', severity: 'error' });
        }
    };

    const handleDeleteComment = async () => {
        if (!deleteTarget || !selectedPageId) return;
        try {
            setDeleteLoading(true);
            const commentId = typeof deleteTarget === 'object' ? deleteTarget.id : deleteTarget;
            const postId = typeof deleteTarget === 'object' ? deleteTarget.postId : null;
            await api.deleteFacebookComment(selectedPageId, commentId);
            if (postId) loadComments(postId);
            setSnackbar({ open: true, message: 'تم حذف التعليق', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف التعليق', severity: 'error' });
        } finally {
            setDeleteLoading(false);
            setDeleteTarget(null);
            setDeleteType('');
        }
    };

    const handleLikeComment = async (comment, postId, parentCommentId = null) => {
        try {
            if (comment.user_likes) {
                await api.unlikeFacebookComment(selectedPageId, comment.id);
            } else {
                await api.likeFacebookComment(selectedPageId, comment.id);
            }
            if (parentCommentId) loadReplies(parentCommentId);
            else loadComments(postId);
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تحديث الإعجاب', severity: 'error' });
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
            await api.editFacebookPost(selectedPageId, editingPostId, { message: editMessage });
            setEditingPostId(null);
            setEditMessage('');
            loadPosts();
            setSnackbar({ open: true, message: 'تم تعديل المنشور', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل تعديل المنشور', severity: 'error' });
        } finally {
            setEditLoading(false);
        }
    };

    const handleDeletePost = async () => {
        if (!deleteTarget || !selectedPageId) return;
        try {
            setDeleteLoading(true);
            await api.deleteFacebookPost(selectedPageId, deleteTarget);
            setPosts(prev => prev.filter(p => p.id !== deleteTarget));
            setSnackbar({ open: true, message: 'تم حذف المنشور', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل حذف المنشور', severity: 'error' });
        } finally {
            setDeleteLoading(false);
            setDeleteTarget(null);
            setDeleteType('');
        }
    };

    const formatTime = (ts) => {
        if (!ts) return '';
        try { return new Date(ts).toLocaleString(locale); } catch { return ts; }
    };

    // Automation quick-setup functions
    const openAutoDialog = async (post) => {
        setAutoTargetPost(post);
        setAutoForm({
            name: `رد تلقائي - ${(post.message || 'منشور').substring(0, 30)}`,
            match_pattern: '',
            response_text: '',
            dm_text: '',
            response_action: 'comment',
            cooldown_seconds: 300,
            trigger_on: 'comment',
            auto_like: false,
        });
        setAutoDialogOpen(true);
        fetchAutoRules(post.id);
    };

    const fetchAutoRules = async (postId) => {
        try {
            setAutoRulesLoading(true);
            const allRules = await api.getAutomationRules({ rule_type: 'comment_reply' });
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
            const selectedTenant = selectedPage?.tenant_id || null;
            await api.createAutomationRule({
                name: autoForm.name,
                rule_type: 'comment_reply',
                channel: 'facebook',
                tenant_id: selectedTenant,
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
            setSnackbar({ open: true, message: 'تم إنشاء قاعدة الأتمتة', severity: 'success' });
            fetchAutoRules(autoTargetPost.id);
            setAutoForm(prev => ({ ...prev, name: '', match_pattern: '', response_text: '', dm_text: '' }));
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إنشاء القاعدة', severity: 'error' });
        } finally {
            setAutoSaving(false);
        }
    };

    const handleToggleAutoRule = async (ruleId) => {
        try {
            await api.toggleAutomationRule(ruleId);
            if (autoTargetPost) fetchAutoRules(autoTargetPost.id);
        } catch {
            setSnackbar({ open: true, message: 'فشل تبديل حالة القاعدة', severity: 'error' });
        }
    };

    const handleSetupAppWebhook = async () => {
        try {
            setWebhookSetupLoading(true);
            await api.setupFacebookAppWebhook();
            setSnackbar({ open: true, message: 'تم إعادة إعداد Webhook التطبيق', severity: 'success' });
            await loadWebhookDiagnostics();
            await loadAllPages();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إعادة إعداد Webhook التطبيق', severity: 'error' });
        } finally {
            setWebhookSetupLoading(false);
        }
    };

    const webhookSummary = webhookDiagnostics?.summary || null;
    const selectedPageDiagnostic = webhookDiagnostics?.linked_pages?.find(page => String(page.id) === String(selectedPageId));
    const webhookFieldEvidence = Object.entries(webhookDiagnostics?.webhook_evidence?.by_field || {});

    if (pagesLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FacebookIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                    <Box>
                        <Typography variant="h4" fontWeight={700}>{t('facebookContent.adminTitle')}</Typography>
                        <Typography variant="body2" color="text.secondary">{t('facebookContent.adminSubtitle')}</Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} onClick={() => { loadAllPages(); if (selectedPageId) loadPosts(); }} variant="outlined">
                    {t('common.refresh')}
                </Button>
            </Box>

            {pagesError && <Alert severity="error" sx={{ mb: 2 }}>{pagesError}</Alert>}

            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' }, gap: 1.5, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <WebhookIcon color="primary" />
                        <Box>
                            <Typography variant="subtitle1" fontWeight={700}>{t('facebookContent.webhookDiagnostics')}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                                {webhookDiagnostics?.expected_callback_url || t('facebookContent.webhookNotLoaded')}
                            </Typography>
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={loadWebhookDiagnostics}
                            disabled={webhookLoading}
                            startIcon={webhookLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                        >
                            {t('facebookContent.checkWebhook')}
                        </Button>
                        <Button
                            variant="contained"
                            size="small"
                            onClick={handleSetupAppWebhook}
                            disabled={webhookSetupLoading}
                            startIcon={webhookSetupLoading ? <CircularProgress size={16} color="inherit" /> : <WebhookIcon />}
                        >
                            {t('facebookContent.setupAppWebhook')}
                        </Button>
                    </Box>
                </Box>

                {webhookError && <Alert severity="error" sx={{ mb: 2 }}>{webhookError}</Alert>}

                {webhookDiagnostics && (
                    <>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: webhookSummary?.warnings?.length ? 2 : 0 }}>
                            <Chip
                                size="small"
                                label={webhookSummary?.app_page_subscription_present ? t('facebookContent.appPagePresent') : t('facebookContent.appPageMissing')}
                                color={webhookSummary?.app_page_subscription_present ? 'success' : 'warning'}
                                variant={webhookSummary?.app_page_subscription_present ? 'filled' : 'outlined'}
                            />
                            <Chip
                                size="small"
                                label={webhookSummary?.app_feed_subscribed ? t('facebookContent.feedPresent') : t('facebookContent.feedMissing')}
                                color={webhookSummary?.app_feed_subscribed ? 'success' : 'error'}
                                variant={webhookSummary?.app_feed_subscribed ? 'filled' : 'outlined'}
                            />
                            <Chip
                                size="small"
                                label={webhookSummary?.app_callback_matches_expected ? t('facebookContent.callbackMatches') : t('facebookContent.callbackNeedsSetup')}
                                color={webhookSummary?.app_callback_matches_expected ? 'success' : 'warning'}
                                variant={webhookSummary?.app_callback_matches_expected ? 'filled' : 'outlined'}
                            />
                            <Chip
                                size="small"
                                label={webhookSummary?.last_page_webhook_at ? t('facebookContent.lastPageWebhook', { time: formatTime(webhookSummary.last_page_webhook_at) }) : t('facebookContent.noPageWebhooks')}
                                color={webhookSummary?.last_page_webhook_at ? 'success' : 'warning'}
                                variant="outlined"
                            />
                        </Box>

                        {webhookFieldEvidence.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                                {webhookFieldEvidence.map(([field, evidence]) => (
                                    <Chip
                                        key={field}
                                        size="small"
                                        label={t('facebookContent.evidenceCount', { field, production: evidence.production_count || 0, total: evidence.count || 0 })}
                                        color={(evidence.production_count || 0) > 0 ? 'success' : 'warning'}
                                        variant="outlined"
                                    />
                                ))}
                            </Box>
                        )}

                        {webhookSummary?.warnings?.length > 0 && (
                            <Alert severity="warning" sx={{ mb: selectedPageDiagnostic ? 2 : 0 }}>
                                {webhookSummary.warnings.join(' ')}
                            </Alert>
                        )}

                        {selectedPageDiagnostic && (
                            <Alert
                                severity={selectedPageDiagnostic.page_subscription_summary?.feed_subscribed || selectedPageDiagnostic.stored_subscribed_fields?.includes('feed') ? 'success' : 'warning'}
                            >
                                {t('facebookContent.selectedPageDiagnostic', {
                                    page: selectedPageDiagnostic.page_name || selectedPageDiagnostic.page_id,
                                    metaFeed: selectedPageDiagnostic.page_subscription_summary?.feed_subscribed ? t('facebookContent.present') : t('facebookContent.uncertain'),
                                    dbFeed: selectedPageDiagnostic.stored_subscribed_fields?.includes('feed') ? t('facebookContent.present') : t('facebookContent.missing'),
                                })}
                            </Alert>
                        )}
                    </>
                )}
            </Paper>

            {/* Page Selector */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>{t('facebookContent.selectPage')}</InputLabel>
                    <Select
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        label={t('facebookContent.selectPage')}
                    >
                        {allPages.length === 0 ? (
                            <MenuItem value="" disabled>{t('facebookContent.noAdminPages')}</MenuItem>
                        ) : (
                            allPages.map(page => (
                                <MenuItem key={page.id} value={page.id}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <FacebookIcon sx={{ color: '#1877f2', fontSize: 18 }} />
                                        <span>{page.page_name || page.page_id}</span>
                                        {page.tenant_name && (
                                            <Chip label={page.tenant_name} size="small" variant="outlined" sx={{ ml: 1, fontSize: '0.7rem' }} />
                                        )}
                                        {!page.is_active && <Chip label={t('facebookContent.disabled')} size="small" color="error" />}
                                        {!page.webhook_subscribed && <Chip label={t('facebookContent.noWebhook')} size="small" color="warning" variant="outlined" />}
                                    </Box>
                                </MenuItem>
                            ))
                        )}
                    </Select>
                </FormControl>
            </Paper>

            {selectedPageId && (
                <Box sx={{ maxWidth: 680, mx: 'auto' }}>
                    {/* Post Composer */}
                    <Paper sx={{ p: 2, mb: 3 }}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                            {t('facebookContent.newPost', { page: selectedPage?.page_name || selectedPage?.page_id })}
                        </Typography>
                        <Tabs value={composerTab} onChange={(e, v) => setComposerTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
                            {POST_TABS.map(tab => (
                                <Tab key={tab.value} value={tab.value} label={t(`facebookContent.tabs.${tab.value}`)} icon={tab.icon} iconPosition="start" sx={{ minHeight: 48 }} />
                            ))}
                        </Tabs>

                        {(composerTab === 'text' || composerTab === 'link' || composerTab === 'schedule') && (
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label={t('facebookContent.postText')}
                                value={composerMessage}
                                onChange={(e) => setComposerMessage(e.target.value)}
                                placeholder={t('facebookContent.postPlaceholder')}
                                sx={{ mb: 2 }}
                            />
                        )}

                        {composerTab === 'photo' && (
                            <>
                                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                                    <Button variant={composerPhotoFile ? 'contained' : 'outlined'} component="label" startIcon={<UploadIcon />}>
                                        {composerPhotoFile ? composerPhotoFile.name : t('facebookContent.uploadFile')}
                                        <input type="file" hidden accept="image/*" onChange={(e) => { setComposerPhotoFile(e.target.files[0] || null); setComposerPhotoUrl(''); }} />
                                    </Button>
                                    <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>{t('facebookContent.or')}</Typography>
                                    <TextField
                                        size="small"
                                        label={t('facebookContent.imageUrl')}
                                        value={composerPhotoUrl}
                                        onChange={(e) => { setComposerPhotoUrl(e.target.value); setComposerPhotoFile(null); }}
                                        placeholder="https://example.com/photo.jpg"
                                        sx={{ flex: 1 }}
                                        disabled={!!composerPhotoFile}
                                    />
                                </Box>
                                <TextField
                                    fullWidth
                                    multiline
                                    rows={2}
                                    label={t('facebookContent.imageCaption')}
                                    value={composerCaption}
                                    onChange={(e) => setComposerCaption(e.target.value)}
                                    placeholder={t('facebookContent.imageCaptionPlaceholder')}
                                    sx={{ mb: 2 }}
                                />
                            </>
                        )}

                        {composerTab === 'link' && (
                            <TextField
                                fullWidth
                                label={t('facebookContent.link')}
                                value={composerLink}
                                onChange={(e) => setComposerLink(e.target.value)}
                                placeholder="https://example.com"
                                sx={{ mb: 2 }}
                            />
                        )}

                        {composerTab === 'schedule' && (
                            <TextField
                                fullWidth
                                type="datetime-local"
                                label={t('facebookContent.scheduleTime')}
                                value={composerScheduleTime}
                                onChange={(e) => setComposerScheduleTime(e.target.value)}
                                InputLabelProps={{ shrink: true }}
                                sx={{ mb: 2 }}
                            />
                        )}

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="contained"
                                onClick={handlePublish}
                                disabled={publishing || !canPublish()}
                                startIcon={publishing ? <CircularProgress size={18} /> : <SendIcon />}
                                sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                            >
                                {publishing ? t('facebookContent.publishing') : (composerTab === 'schedule' ? t('facebookContent.schedulePost') : t('facebookContent.publishPost'))}
                            </Button>
                        </Box>
                    </Paper>

                    {/* Posts Feed */}
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>{t('facebookContent.posts')}</Typography>

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
                                                <TextField
                                                    fullWidth
                                                    multiline
                                                    rows={3}
                                                    value={editMessage}
                                                    onChange={(e) => setEditMessage(e.target.value)}
                                                />
                                                <Box sx={{ mt: 1, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                                    <Button size="small" onClick={() => setEditingPostId(null)}>{t('common.cancel')}</Button>
                                                    <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={editLoading}>
                                                        {editLoading ? <CircularProgress size={16} /> : t('common.save')}
                                                    </Button>
                                                </Box>
                                            </Box>
                                        ) : (
                                            (() => {
                                                const msg = post.message || t('facebookContent.untitledPost');
                                                const isLong = msg.length > POST_TRUNCATE_LENGTH;
                                                const isExpanded = expandedPosts[post.id];
                                                return (
                                                    <Box>
                                                        <Typography sx={{ whiteSpace: 'pre-wrap', mb: post.full_picture ? 1 : 0 }}>
                                                            {isLong && !isExpanded
                                                                ? msg.substring(0, POST_TRUNCATE_LENGTH) + '...'
                                                                : msg
                                                            }
                                                        </Typography>
                                                        {isLong && (
                                                            <Button size="small" onClick={() => setExpandedPosts(prev => ({ ...prev, [post.id]: !prev[post.id] }))}>
                                                                {isExpanded ? t('facebookContent.showLess') : t('facebookContent.showMore')}
                                                            </Button>
                                                        )}
                                                    </Box>
                                                );
                                            })()
                                        )}

                                        {post.full_picture && (
                                            <CardMedia
                                                component="img"
                                                image={post.full_picture}
                                                sx={{ maxHeight: 300, borderRadius: 1, mt: 1, objectFit: 'cover' }}
                                                alt="Post image"
                                            />
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
                                                <IconButton size="small" component="a" href={post.permalink_url} target="_blank" rel="noopener">
                                                    <OpenInNewIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </Box>
                                    </CardContent>

                                    <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 1 }}>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Button size="small" startIcon={<CommentIcon />} onClick={() => toggleComments(post.id)}>
                                                {expandedComments[post.id] ? t('facebookContent.hideComments') : t('facebookContent.comments')}
                                                {expandedComments[post.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </Button>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Tooltip title={t('facebookContent.automateComments')}>
                                                <IconButton size="small" color="primary" onClick={() => openAutoDialog(post)}><BoltIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title={t('facebookContent.edit')}>
                                                <IconButton size="small" onClick={() => handleStartEdit(post)}><EditIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title={t('facebookContent.delete')}>
                                                <IconButton size="small" color="error" onClick={() => { setDeleteTarget(post.id); setDeleteType('post'); }}><DeleteIcon fontSize="small" /></IconButton>
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
                                                                {/* Reply input for this comment */}
                                                                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                                    <TextField
                                                                        size="small"
                                                                        placeholder={t('facebookContent.replyPlaceholder')}
                                                                        value={replyTexts[comment.id] || ''}
                                                                        onChange={(e) => setReplyTexts(prev => ({ ...prev, [comment.id]: e.target.value }))}
                                                                        sx={{ flex: 1 }}
                                                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(comment.id, post.id); } }}
                                                                    />
                                                                    <IconButton size="small" color="primary" onClick={() => handleReply(comment.id, post.id)} disabled={replyLoading[comment.id]}>
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
                                                </>
                                            )}
                                        </Box>
                                    </Collapse>
                                </Card>
                            ))}

                            {postsPaging?.next && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                    <Button variant="outlined" onClick={() => loadPosts(true)} disabled={loadingMore}>
                                        {loadingMore ? <CircularProgress size={20} /> : t('facebookContent.loadMore')}
                                    </Button>
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteType(''); }}>
                <DialogTitle>{deleteType === 'post' ? t('facebookContent.deletePost') : t('facebookContent.deleteComment')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('facebookContent.deleteConfirm', { target: deleteType === 'post' ? t('facebookContent.thisPost') : t('facebookContent.thisComment') })}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setDeleteTarget(null); setDeleteType(''); }}>{t('common.cancel')}</Button>
                    <Button variant="contained" color="error" onClick={deleteType === 'post' ? handleDeletePost : handleDeleteComment} disabled={deleteLoading}>
                        {deleteLoading ? <CircularProgress size={18} /> : t('facebookContent.delete')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>

            {/* Per-Post Automation Dialog */}
            <Dialog open={autoDialogOpen} onClose={() => setAutoDialogOpen(false)} maxWidth="sm" fullWidth>
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

                    {/* Existing rules for this post */}
                    {autoRulesLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                    ) : autoRules.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('facebookContent.currentRules')}</Typography>
                            {autoRules.map(rule => (
                                <Box key={rule.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, mb: 0.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                                    <Switch
                                        checked={!!rule.is_active}
                                        onChange={() => handleToggleAutoRule(rule.id)}
                                        size="small"
                                        color="success"
                                    />
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2" fontWeight="bold">{rule.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {rule.trigger_on === 'reaction' ? t('facebookContent.reactions') : rule.trigger_on === 'both' ? `${t('facebookContent.commentsOnly')}+${t('facebookContent.reactions')}` : t('facebookContent.commentsOnly')}
                                            {rule.match_pattern ? ` • كلمات: ${rule.match_pattern}` : ''}
                                            {' • '}
                                            {rule.response_action === 'comment' ? t('facebookContent.publicReply') : rule.response_action === 'dm' ? t('facebookContent.privateMessage') : t('facebookContent.both')}
                                            {' • '}
                                            {rule.trigger_count || 0} تشغيل
                                        </Typography>
                                    </Box>
                                    <Chip
                                        label={rule.target_post_id ? t('facebookContent.thisPost') : t('messengerBot.general')}
                                        size="small"
                                        variant="outlined"
                                        color={rule.target_post_id ? 'primary' : 'default'}
                                    />
                                </Box>
                            ))}
                        </Box>
                    )}

                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{t('facebookContent.newRule')}</Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                            label={t('facebookContent.ruleName')}
                            value={autoForm.name}
                            onChange={e => setAutoForm(p => ({ ...p, name: e.target.value }))}
                            fullWidth
                            size="small"
                        />
                        <TextField
                            label={t('facebookContent.keywords')}
                            value={autoForm.match_pattern}
                            onChange={e => setAutoForm(p => ({ ...p, match_pattern: e.target.value }))}
                            fullWidth
                            size="small"
                            placeholder={t('facebookContent.keywordsPlaceholder')}
                        />

                        <Typography variant="caption" color="primary">{t('facebookContent.ruleTrigger')}</Typography>
                        <RadioGroup
                            row
                            value={autoForm.trigger_on}
                            onChange={e => {
                                const val = e.target.value;
                                setAutoForm(p => ({
                                    ...p,
                                    trigger_on: val,
                                    response_action: val === 'reaction' ? 'dm' : p.response_action,
                                }));
                            }}
                        >
                            <FormControlLabel value="comment" control={<Radio size="small" />} label={t('facebookContent.commentsOnly')} />
                            <FormControlLabel value="reaction" control={<Radio size="small" />} label={t('facebookContent.reactions')} />
                            <FormControlLabel value="both" control={<Radio size="small" />} label={t('facebookContent.both')} />
                        </RadioGroup>

                        <Typography variant="caption" color="primary">{t('facebookContent.responseType')}</Typography>
                        <RadioGroup
                            row
                            value={autoForm.response_action}
                            onChange={e => setAutoForm(p => ({ ...p, response_action: e.target.value }))}
                        >
                            <FormControlLabel value="comment" control={<Radio size="small" />} label={t('facebookContent.publicReply')} disabled={autoForm.trigger_on === 'reaction'} />
                            <FormControlLabel value="dm" control={<Radio size="small" />} label={t('facebookContent.privateMessage')} />
                            <FormControlLabel value="both" control={<Radio size="small" />} label={t('facebookContent.both')} disabled={autoForm.trigger_on === 'reaction'} />
                        </RadioGroup>

                        {/* Auto-like toggle */}
                        {(autoForm.trigger_on === 'comment' || autoForm.trigger_on === 'both') && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={autoForm.auto_like}
                                        onChange={e => setAutoForm(p => ({ ...p, auto_like: e.target.checked }))}
                                        color="primary"
                                        size="small"
                                    />
                                }
                                label={t('facebookContent.autoLike')}
                            />
                        )}

                        {(autoForm.response_action === 'comment' || autoForm.response_action === 'both') && (
                            <TextField
                                label={t('facebookContent.publicReplyText')}
                                value={autoForm.response_text}
                                onChange={e => setAutoForm(p => ({ ...p, response_text: e.target.value }))}
                                multiline
                                rows={2}
                                fullWidth
                                size="small"
                                placeholder={t('facebookContent.publicReplyPlaceholder')}
                            />
                        )}
                        {(autoForm.response_action === 'dm' || autoForm.response_action === 'both') && (
                            <TextField
                                label={t('facebookContent.privateMessageText')}
                                value={autoForm.dm_text}
                                onChange={e => setAutoForm(p => ({ ...p, dm_text: e.target.value }))}
                                multiline
                                rows={2}
                                fullWidth
                                size="small"
                                placeholder={t('facebookContent.privateMessagePlaceholder')}
                            />
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

export default FacebookPageManager;
