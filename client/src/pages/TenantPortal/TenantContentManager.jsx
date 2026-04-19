import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, TextField, Select, MenuItem, FormControl,
    InputLabel, CircularProgress, Alert, Snackbar, Chip, Avatar, IconButton,
    Card, CardContent, CardMedia, CardActions, Collapse, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider, Tab, Tabs, Tooltip,
    RadioGroup, Radio, FormControlLabel, Switch
} from '@mui/material';
import {
    Facebook as FacebookIcon, Send as SendIcon, Delete as DeleteIcon,
    Edit as EditIcon, Link as LinkIcon, Image as ImageIcon,
    Schedule as ScheduleIcon, TextSnippet as TextIcon, Refresh as RefreshIcon,
    ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
    ChatBubble as CommentIcon, OpenInNew as OpenInNewIcon,
    CloudUpload as UploadIcon, SmartToy as AutomationIcon, Bolt as BoltIcon
} from '@mui/icons-material';
import api from '../../api';

const POST_TABS = [
    { value: 'text', label: 'نص', icon: <TextIcon /> },
    { value: 'photo', label: 'صورة', icon: <ImageIcon /> },
    { value: 'link', label: 'رابط', icon: <LinkIcon /> },
    { value: 'schedule', label: 'جدولة', icon: <ScheduleIcon /> },
];

const POST_TRUNCATE_LENGTH = 200;

const TenantContentManager = () => {
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
    const [replyTexts, setReplyTexts] = useState({});
    const [replyLoading, setReplyLoading] = useState({});

    const [editingPostId, setEditingPostId] = useState(null);
    const [editMessage, setEditMessage] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteType, setDeleteType] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);

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
            setPagesError(err.message || 'فشل جلب صفحات فيسبوك');
            setPages([]);
        } finally {
            setPagesLoading(false);
        }
    }, []);

    useEffect(() => { loadPages(); }, [loadPages]);

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
            const data = await api.getPortalFbPosts(selectedPageId, params);
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
            setSnackbar({ open: true, message: 'تم نشر المنشور بنجاح', severity: 'success' });
            loadPosts();
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل نشر المنشور', severity: 'error' });
        } finally {
            setPublishing(false);
        }
    };

    const loadComments = async (postId) => {
        try {
            setCommentsLoading(prev => ({ ...prev, [postId]: true }));
            const data = await api.getPortalFbComments(selectedPageId, postId, { limit: 100 });
            setCommentsData(prev => ({ ...prev, [postId]: data.comments || [] }));
        } catch (err) {
            console.error('Failed to load comments:', err);
        } finally {
            setCommentsLoading(prev => ({ ...prev, [postId]: false }));
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

    const handleReply = async (commentId) => {
        const message = replyTexts[commentId];
        if (!message?.trim() || !selectedPageId) return;
        try {
            setReplyLoading(prev => ({ ...prev, [commentId]: true }));
            await api.replyPortalFbComment(selectedPageId, commentId, message);
            setReplyTexts(prev => ({ ...prev, [commentId]: '' }));
            const postId = Object.keys(expandedComments).find(pid => expandedComments[pid]);
            if (postId) loadComments(postId);
            setSnackbar({ open: true, message: 'تم إرسال الرد', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'فشل إرسال الرد', severity: 'error' });
        } finally {
            setReplyLoading(prev => ({ ...prev, [commentId]: false }));
        }
    };

    const handleHideComment = async (commentId, currentlyHidden) => {
        try {
            await api.hidePortalFbComment(selectedPageId, commentId, !currentlyHidden);
            const postId = Object.keys(expandedComments).find(pid => expandedComments[pid]);
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
            await api.deletePortalFbComment(selectedPageId, deleteTarget);
            const postId = Object.keys(expandedComments).find(pid => expandedComments[pid]);
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
            await api.deletePortalFbPost(selectedPageId, deleteTarget);
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
        try { return new Date(ts).toLocaleString('ar-LY'); } catch { return ts; }
    };

    const openAutoDialog = async (post) => {
        setAutoTargetPost(post);
        setAutoForm({
            name: `رد تلقائي - ${(post.message || 'منشور').substring(0, 30)}`,
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
            await api.togglePortalAutomationRule(ruleId);
            if (autoTargetPost) fetchAutoRules(autoTargetPost.id);
        } catch {
            setSnackbar({ open: true, message: 'فشل تبديل حالة القاعدة', severity: 'error' });
        }
    };

    if (pagesLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3, gap: { xs: 1, md: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FacebookIcon sx={{ fontSize: 32, color: '#1877f2' }} />
                    <Box>
                        <Typography variant="h4" fontWeight={700}>إدارة المحتوى</Typography>
                        <Typography variant="body2" color="text.secondary">إنشاء وإدارة المنشورات والتعليقات على صفحتك</Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} onClick={() => { loadPages(); if (selectedPageId) loadPosts(); }} variant="outlined">
                    تحديث
                </Button>
            </Box>

            {pagesError && <Alert severity="error" sx={{ mb: 2 }}>{pagesError}</Alert>}

            <Paper sx={{ p: 2, mb: 3 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>اختر صفحة فيسبوك</InputLabel>
                    <Select
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        label="اختر صفحة فيسبوك"
                    >
                        {pages.length === 0 ? (
                            <MenuItem value="" disabled>لا توجد صفحات مربوطة — تواصل مع المدير</MenuItem>
                        ) : (
                            pages.map(page => (
                                <MenuItem key={page.id} value={page.id}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <FacebookIcon sx={{ color: '#1877f2', fontSize: 18 }} />
                                        <span>{page.page_name || page.page_id}</span>
                                        {!page.is_active && <Chip label="معطلة" size="small" color="error" />}
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
                            منشور جديد — {selectedPage?.page_name || selectedPage?.page_id}
                        </Typography>
                        <Tabs value={composerTab} onChange={(e, v) => setComposerTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
                            {POST_TABS.map(tab => (
                                <Tab key={tab.value} value={tab.value} label={tab.label} icon={tab.icon} iconPosition="start" sx={{ minHeight: 48 }} />
                            ))}
                        </Tabs>

                        {(composerTab === 'text' || composerTab === 'link' || composerTab === 'schedule') && (
                            <TextField
                                fullWidth multiline rows={3} label="نص المنشور"
                                value={composerMessage}
                                onChange={(e) => setComposerMessage(e.target.value)}
                                placeholder="اكتب منشوراً جديداً..." sx={{ mb: 2 }}
                            />
                        )}

                        {composerTab === 'photo' && (
                            <>
                                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                                    <Button variant={composerPhotoFile ? 'contained' : 'outlined'} component="label" startIcon={<UploadIcon />}>
                                        {composerPhotoFile ? composerPhotoFile.name : 'رفع ملف'}
                                        <input type="file" hidden accept="image/*" onChange={(e) => { setComposerPhotoFile(e.target.files[0] || null); setComposerPhotoUrl(''); }} />
                                    </Button>
                                    <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>أو</Typography>
                                    <TextField
                                        size="small" label="رابط الصورة"
                                        value={composerPhotoUrl}
                                        onChange={(e) => { setComposerPhotoUrl(e.target.value); setComposerPhotoFile(null); }}
                                        placeholder="https://example.com/photo.jpg" sx={{ flex: 1 }}
                                        disabled={!!composerPhotoFile}
                                    />
                                </Box>
                                <TextField fullWidth multiline rows={2} label="وصف الصورة" value={composerCaption} onChange={(e) => setComposerCaption(e.target.value)} placeholder="أضف وصفاً للصورة..." sx={{ mb: 2 }} />
                            </>
                        )}

                        {composerTab === 'link' && (
                            <TextField fullWidth label="رابط" value={composerLink} onChange={(e) => setComposerLink(e.target.value)} placeholder="https://example.com" sx={{ mb: 2 }} />
                        )}

                        {composerTab === 'schedule' && (
                            <TextField fullWidth type="datetime-local" label="وقت النشر المجدول" value={composerScheduleTime} onChange={(e) => setComposerScheduleTime(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ mb: 2 }} />
                        )}

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="contained" onClick={handlePublish}
                                disabled={publishing || (!composerMessage?.trim() && composerTab !== 'photo')}
                                startIcon={publishing ? <CircularProgress size={18} /> : <SendIcon />}
                                sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                            >
                                {publishing ? 'جاري النشر...' : (composerTab === 'schedule' ? 'جدولة المنشور' : 'نشر المنشور')}
                            </Button>
                        </Box>
                    </Paper>

                    <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>المنشورات</Typography>

                    {postsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                    ) : postsError ? (
                        <Alert severity="error">{postsError}</Alert>
                    ) : posts.length === 0 ? (
                        <Paper sx={{ p: 4, textAlign: 'center' }}>
                            <Typography color="text.secondary">لا توجد منشورات بعد</Typography>
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
                                                    <Button size="small" onClick={() => setEditingPostId(null)}>إلغاء</Button>
                                                    <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={editLoading}>
                                                        {editLoading ? <CircularProgress size={16} /> : 'حفظ'}
                                                    </Button>
                                                </Box>
                                            </Box>
                                        ) : (
                                            (() => {
                                                const msg = post.message || '(منشور بدون نص)';
                                                const isLong = msg.length > POST_TRUNCATE_LENGTH;
                                                const isExpanded = expandedPosts[post.id];
                                                return (
                                                    <Box>
                                                        <Typography sx={{ whiteSpace: 'pre-wrap', mb: post.full_picture ? 1 : 0 }}>
                                                            {isLong && !isExpanded ? msg.substring(0, POST_TRUNCATE_LENGTH) + '...' : msg}
                                                        </Typography>
                                                        {isLong && (
                                                            <Button size="small" onClick={() => setExpandedPosts(prev => ({ ...prev, [post.id]: !prev[post.id] }))}>
                                                                {isExpanded ? 'عرض أقل' : 'عرض المزيد'}
                                                            </Button>
                                                        )}
                                                    </Box>
                                                );
                                            })()
                                        )}

                                        {post.full_picture && (
                                            <CardMedia component="img" image={post.full_picture} sx={{ maxHeight: 300, borderRadius: 1, mt: 1, objectFit: 'cover' }} alt="Post image" />
                                        )}

                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
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
                                                {expandedComments[post.id] ? 'إخفاء التعليقات' : 'التعليقات'}
                                                {expandedComments[post.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </Button>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Tooltip title="أتمتة التعليقات">
                                                <IconButton size="small" color="primary" onClick={() => openAutoDialog(post)}><BoltIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title="تعديل">
                                                <IconButton size="small" onClick={() => handleStartEdit(post)}><EditIcon fontSize="small" /></IconButton>
                                            </Tooltip>
                                            <Tooltip title="حذف">
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
                                                    {(commentsData[post.id] || []).map(comment => (
                                                        <Box key={comment.id} sx={{ display: 'flex', gap: 1, mb: 2, p: 1, bgcolor: comment.is_hidden ? 'action.hover' : 'background.paper', borderRadius: 1, opacity: comment.is_hidden ? 0.6 : 1 }}>
                                                            <Avatar src={comment.from?.picture?.data?.url} sx={{ width: 32, height: 32 }}>
                                                                {comment.from?.name?.charAt(0)}
                                                            </Avatar>
                                                            <Box sx={{ flex: 1 }}>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                    <Typography variant="subtitle2">{comment.from?.name || 'مستخدم'}</Typography>
                                                                    {comment.is_hidden && <Chip label="مخفي" size="small" color="error" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
                                                                </Box>
                                                                <Typography variant="body2">{comment.message}</Typography>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                                    <Typography variant="caption" color="text.secondary">{formatTime(comment.created_time)}</Typography>
                                                                    <Typography variant="caption" color="text.secondary">• 👍 {comment.like_count || 0}</Typography>
                                                                </Box>
                                                                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                                                                    <Button size="small" variant="text" onClick={() => handleHideComment(comment.id, comment.is_hidden)}>
                                                                        {comment.is_hidden ? 'إظهار' : 'إخفاء'}
                                                                    </Button>
                                                                    <Button size="small" variant="text" color="error" onClick={() => { setDeleteTarget(comment.id); setDeleteType('comment'); }}>
                                                                        حذف
                                                                    </Button>
                                                                </Box>
                                                                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                                    <TextField
                                                                        size="small" placeholder="اكتب رداً..."
                                                                        value={replyTexts[comment.id] || ''}
                                                                        onChange={(e) => setReplyTexts(prev => ({ ...prev, [comment.id]: e.target.value }))}
                                                                        sx={{ flex: 1 }}
                                                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(comment.id); } }}
                                                                    />
                                                                    <IconButton size="small" color="primary" onClick={() => handleReply(comment.id)} disabled={replyLoading[comment.id]}>
                                                                        {replyLoading[comment.id] ? <CircularProgress size={16} /> : <SendIcon />}
                                                                    </IconButton>
                                                                </Box>
                                                            </Box>
                                                        </Box>
                                                    ))}
                                                    {(commentsData[post.id] || []).length === 0 && (
                                                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>لا توجد تعليقات</Typography>
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
                                        {loadingMore ? <CircularProgress size={20} /> : 'تحميل المزيد'}
                                    </Button>
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}

            <Dialog open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteType(''); }}>
                <DialogTitle>{deleteType === 'post' ? 'حذف المنشور' : 'حذف التعليق'}</DialogTitle>
                <DialogContent>
                    <Typography>هل أنت متأكد من حذف {deleteType === 'post' ? 'هذا المنشور' : 'هذا التعليق'}؟ لا يمكن التراجع عن هذا الإجراء.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setDeleteTarget(null); setDeleteType(''); }}>إلغاء</Button>
                    <Button variant="contained" color="error" onClick={deleteType === 'post' ? handleDeletePost : handleDeleteComment} disabled={deleteLoading}>
                        {deleteLoading ? <CircularProgress size={18} /> : 'حذف'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>

            <Dialog open={autoDialogOpen} onClose={() => setAutoDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BoltIcon color="primary" />
                    أتمتة التعليقات
                </DialogTitle>
                <DialogContent dividers>
                    {autoTargetPost && (
                        <Alert severity="info" sx={{ mb: 2, fontSize: '0.85rem' }}>
                            المنشور: "{(autoTargetPost.message || 'بدون نص').substring(0, 80)}{(autoTargetPost.message || '').length > 80 ? '...' : ''}"
                        </Alert>
                    )}

                    {autoRulesLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                    ) : autoRules.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>القواعد الحالية</Typography>
                            {autoRules.map(rule => (
                                <Box key={rule.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, mb: 0.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                                    <Switch checked={!!rule.is_active} onChange={() => handleToggleAutoRule(rule.id)} size="small" color="success" />
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2" fontWeight="bold">{rule.name}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {rule.trigger_on === 'reaction' ? 'تفاعلات' : rule.trigger_on === 'both' ? 'تعليقات+تفاعلات' : 'تعليقات'}
                                            {rule.match_pattern ? ` • كلمات: ${rule.match_pattern}` : ''}
                                            {' • '}
                                            {rule.response_action === 'comment' ? 'رد عام' : rule.response_action === 'dm' ? 'رسالة خاصة' : 'كلاهما'}
                                            {' • '}
                                            {rule.trigger_count || 0} تشغيل
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}

                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1.5 }}>إنشاء قاعدة جديدة لهذا المنشور</Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField label="اسم القاعدة" value={autoForm.name} onChange={e => setAutoForm(p => ({ ...p, name: e.target.value }))} fullWidth size="small" />
                        <TextField label="كلمات مفتاحية (اتركه فارغاً للرد على الكل)" value={autoForm.match_pattern} onChange={e => setAutoForm(p => ({ ...p, match_pattern: e.target.value }))} fullWidth size="small" placeholder="مثال: سعر,تفاصيل,كم" />

                        <Typography variant="caption" color="primary">مشغل القاعدة</Typography>
                        <RadioGroup row value={autoForm.trigger_on} onChange={e => {
                            const val = e.target.value;
                            setAutoForm(p => ({ ...p, trigger_on: val, response_action: val === 'reaction' ? 'dm' : p.response_action }));
                        }}>
                            <FormControlLabel value="comment" control={<Radio size="small" />} label="تعليقات" />
                            <FormControlLabel value="reaction" control={<Radio size="small" />} label="تفاعلات" />
                            <FormControlLabel value="both" control={<Radio size="small" />} label="كلاهما" />
                        </RadioGroup>

                        <Typography variant="caption" color="primary">نوع الرد</Typography>
                        <RadioGroup row value={autoForm.response_action} onChange={e => setAutoForm(p => ({ ...p, response_action: e.target.value }))}>
                            <FormControlLabel value="comment" control={<Radio size="small" />} label="رد عام" disabled={autoForm.trigger_on === 'reaction'} />
                            <FormControlLabel value="dm" control={<Radio size="small" />} label="رسالة خاصة" />
                            <FormControlLabel value="both" control={<Radio size="small" />} label="كلاهما" disabled={autoForm.trigger_on === 'reaction'} />
                        </RadioGroup>

                        {(autoForm.trigger_on === 'comment' || autoForm.trigger_on === 'both') && (
                            <FormControlLabel
                                control={<Switch checked={autoForm.auto_like} onChange={e => setAutoForm(p => ({ ...p, auto_like: e.target.checked }))} color="primary" size="small" />}
                                label="إعجاب تلقائي على التعليق"
                            />
                        )}

                        {(autoForm.response_action === 'comment' || autoForm.response_action === 'both') && (
                            <TextField label="نص التعليق العام" value={autoForm.response_text} onChange={e => setAutoForm(p => ({ ...p, response_text: e.target.value }))} multiline rows={2} fullWidth size="small" placeholder="الرد الذي سيظهر كتعليق..." />
                        )}
                        {(autoForm.response_action === 'dm' || autoForm.response_action === 'both') && (
                            <TextField label="نص الرسالة الخاصة" value={autoForm.dm_text} onChange={e => setAutoForm(p => ({ ...p, dm_text: e.target.value }))} multiline rows={2} fullWidth size="small" placeholder="الرسالة الخاصة التي ستُرسل للمعلق..." />
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAutoDialogOpen(false)}>إغلاق</Button>
                    <Button
                        variant="contained"
                        onClick={handleCreateAutoRule}
                        disabled={autoSaving || !autoForm.name || (!autoForm.response_text && !autoForm.dm_text)}
                        startIcon={autoSaving ? <CircularProgress size={16} color="inherit" /> : <BoltIcon />}
                    >
                        {autoSaving ? 'جاري الحفظ...' : 'إنشاء قاعدة'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TenantContentManager;
