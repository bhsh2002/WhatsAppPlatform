import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, TextField, Select, MenuItem, FormControl,
    InputLabel, CircularProgress, Alert, Snackbar, Chip, Avatar, IconButton,
    Card, CardContent, CardMedia, CardActions, Collapse, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider, Grid, Tab, Tabs, Tooltip
} from '@mui/material';
import {
    Facebook as FacebookIcon, Send as SendIcon, Delete as DeleteIcon,
    Edit as EditIcon, Visibility as ViewIcon, VisibilityOff as HideIcon,
    Link as LinkIcon, Image as ImageIcon, Schedule as ScheduleIcon,
    TextSnippet as TextIcon, Refresh as RefreshIcon, ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon, ThumbUp as LikeIcon, ChatBubble as CommentIcon,
    Share as ShareIcon, OpenInNew as OpenInNewIcon, CloudUpload as UploadIcon
} from '@mui/icons-material';
import api from '../../api';

const POST_TABS = [
    { value: 'text', label: 'نص', icon: <TextIcon /> },
    { value: 'photo', label: 'صورة', icon: <ImageIcon /> },
    { value: 'link', label: 'رابط', icon: <LinkIcon /> },
    { value: 'schedule', label: 'جدولة', icon: <ScheduleIcon /> },
];

const FacebookPageManager = () => {
    const [allPages, setAllPages] = useState([]);
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

    const loadComments = async (postId) => {
        try {
            setCommentsLoading(prev => ({ ...prev, [postId]: true }));
            const data = await api.getFacebookComments(selectedPageId, postId, { limit: 100 });
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
            if (!commentsData[postId]) {
                loadComments(postId);
            }
        }
    };

    const handleReply = async (commentId) => {
        const message = replyTexts[commentId];
        if (!message?.trim() || !selectedPageId) return;
        try {
            setReplyLoading(prev => ({ ...prev, [commentId]: true }));
            await api.replyToFacebookComment(selectedPageId, commentId, message);
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
            await api.hideFacebookComment(selectedPageId, commentId, !currentlyHidden);
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
            await api.deleteFacebookComment(selectedPageId, deleteTarget);
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
        try { return new Date(ts).toLocaleString('ar-LY'); } catch { return ts; }
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
                        <Typography variant="h4" fontWeight={700}>إدارة محتوى فيسبوك</Typography>
                        <Typography variant="body2" color="text.secondary">إنشاء وإدارة المنشورات والتعليقات على الصفحات المربوطة</Typography>
                    </Box>
                </Box>
                <Button startIcon={<RefreshIcon />} onClick={() => { loadAllPages(); if (selectedPageId) loadPosts(); }} variant="outlined">
                    تحديث
                </Button>
            </Box>

            {pagesError && <Alert severity="error" sx={{ mb: 2 }}>{pagesError}</Alert>}

            {/* Page Selector */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <FormControl fullWidth size="small">
                    <InputLabel>اختر صفحة فيسبوك</InputLabel>
                    <Select
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        label="اختر صفحة فيسبوك"
                    >
                        {allPages.length === 0 ? (
                            <MenuItem value="" disabled>لا توجد صفحات مربوطة — اربط صفحة من إدارة العملاء</MenuItem>
                        ) : (
                            allPages.map(page => (
                                <MenuItem key={page.id} value={page.id}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <FacebookIcon sx={{ color: '#1877f2', fontSize: 18 }} />
                                        <span>{page.page_name || page.page_id}</span>
                                        {page.tenant_name && (
                                            <Chip label={page.tenant_name} size="small" variant="outlined" sx={{ ml: 1, fontSize: '0.7rem' }} />
                                        )}
                                        {!page.is_active && <Chip label="معطلة" size="small" color="error" />}
                                        {!page.webhook_subscribed && <Chip label="بدون Webhook" size="small" color="warning" variant="outlined" />}
                                    </Box>
                                </MenuItem>
                            ))
                        )}
                    </Select>
                </FormControl>
            </Paper>

            {selectedPageId && (
                <>
                    {/* Post Composer */}
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
                                fullWidth
                                multiline
                                rows={3}
                                label="نص المنشور"
                                value={composerMessage}
                                onChange={(e) => setComposerMessage(e.target.value)}
                                placeholder="اكتب منشوراً جديداً..."
                                sx={{ mb: 2 }}
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
                                        size="small"
                                        label="رابط الصورة"
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
                                    label="وصف الصورة"
                                    value={composerCaption}
                                    onChange={(e) => setComposerCaption(e.target.value)}
                                    placeholder="أضف وصفاً للصورة..."
                                    sx={{ mb: 2 }}
                                />
                            </>
                        )}

                        {composerTab === 'link' && (
                            <TextField
                                fullWidth
                                label="رابط"
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
                                label="وقت النشر المجدول"
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
                                disabled={publishing || (!composerMessage?.trim() && composerTab !== 'photo')}
                                startIcon={publishing ? <CircularProgress size={18} /> : <SendIcon />}
                                sx={{ bgcolor: '#1877f2', '&:hover': { bgcolor: '#1565c0' } }}
                            >
                                {publishing ? 'جاري النشر...' : (composerTab === 'schedule' ? 'جدولة المنشور' : 'نشر المنشور')}
                            </Button>
                        </Box>
                    </Paper>

                    {/* Posts Feed */}
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
                                                <TextField
                                                    fullWidth
                                                    multiline
                                                    rows={3}
                                                    value={editMessage}
                                                    onChange={(e) => setEditMessage(e.target.value)}
                                                />
                                                <Box sx={{ mt: 1, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                                    <Button size="small" onClick={() => setEditingPostId(null)}>إلغاء</Button>
                                                    <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={editLoading}>
                                                        {editLoading ? <CircularProgress size={16} /> : 'حفظ'}
                                                    </Button>
                                                </Box>
                                            </Box>
                                        ) : (
                                            <Typography sx={{ whiteSpace: 'pre-wrap', mb: post.full_picture ? 1 : 0 }}>
                                                {post.message || '(منشور بدون نص)'}
                                            </Typography>
                                        )}

                                        {post.full_picture && (
                                            <CardMedia
                                                component="img"
                                                image={post.full_picture}
                                                sx={{ maxHeight: 300, borderRadius: 1, mt: 1, objectFit: 'cover' }}
                                                alt="Post image"
                                            />
                                        )}

                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
                                            {post.likes?.summary?.total_count !== undefined && (
                                                <Chip icon={<LikeIcon />} label={post.likes.summary.total_count} size="small" variant="outlined" />
                                            )}
                                            {post.comments?.summary?.total_count !== undefined && (
                                                <Chip
                                                    icon={<CommentIcon />}
                                                    label={post.comments.summary.total_count}
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() => toggleComments(post.id)}
                                                    sx={{ cursor: 'pointer' }}
                                                />
                                            )}
                                            {post.shares?.count !== undefined && (
                                                <Chip icon={<ShareIcon />} label={post.shares.count} size="small" variant="outlined" />
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
                                                {expandedComments[post.id] ? 'إخفاء التعليقات' : `التعليقات (${post.comments?.summary?.total_count || 0})`}
                                                {expandedComments[post.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </Button>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
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
                                                                {/* Reply input for this comment */}
                                                                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                                    <TextField
                                                                        size="small"
                                                                        placeholder="اكتب رداً..."
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
                </>
            )}

            {/* Delete Confirmation Dialog */}
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
        </Box>
    );
};

export default FacebookPageManager;