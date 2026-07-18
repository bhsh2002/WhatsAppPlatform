import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Snackbar,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    ArchiveOutlined as ArchiveIcon,
    AutoAwesome as AutoAwesomeIcon,
    CalendarMonth as CalendarIcon,
    Campaign as CampaignIcon,
    CheckCircleOutline as ApproveIcon,
    ContentCopy as LibraryIcon,
    DeleteOutline as DeleteIcon,
    EditOutlined as EditIcon,
    Facebook as FacebookIcon,
    Inventory2Outlined as ProductIcon,
    PauseCircleOutline as PauseIcon,
    PlayCircleOutline as PlayIcon,
    Refresh as RefreshIcon,
    RocketLaunchOutlined as PublishIcon,
    Schedule as ScheduleIcon,
    SettingsOutlined as SettingsIcon,
    Tune as TuneIcon,
} from '@mui/icons-material';

import api from '../../api';
import Select from '../../components/Form/AccessibleSelect';
import { PageTitle } from '../../components/Layout/PageTitle';
import { useLanguage } from '../../context/LanguageContext';
import { buildFacebookPostLibraryDraft } from '../Facebook/facebookContentConfig';
import TenantContentManager from './TenantContentManager';

const gridSx = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
    gap: 2,
};

const actionsSx = {
    px: 2,
    pb: 2,
    pt: 0,
    gap: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
};

const wrapTextSx = {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
};

const dialogPaperProps = {
    sx: {
        m: { xs: 1, sm: 2 },
        width: { xs: 'calc(100% - 16px)', sm: '100%' },
        maxHeight: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 32px)' },
    },
};

const toLocalDateTimeInput = (date = new Date(Date.now() + 60 * 60 * 1000)) => {
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000));
    return local.toISOString().slice(0, 16);
};

const parseCsv = value => String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const joinCsv = value => (Array.isArray(value) ? value : []).join(', ');

const statusColor = status => ({
    active: 'success',
    approved: 'success',
    published: 'success',
    processing: 'info',
    pending: 'warning',
    review: 'warning',
    failed: 'error',
    paused: 'default',
    draft: 'default',
    completed: 'default',
    archived: 'default',
    cancelled: 'default',
    skipped: 'default',
}[status] || 'default');

const statusLabel = (t, status) => t(`contentStudio.status.${status || 'unknown'}`);

const formatDateTime = (value, locale) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale || 'ar-LY', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
};

const SectionHeading = ({ title, subtitle, action }) => (
    <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: 2,
    }}>
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h2" fontWeight={800}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary" sx={wrapTextSx}>{subtitle}</Typography>}
        </Box>
        {action}
    </Box>
);

const EmptyPanel = ({ children }) => (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
        <Typography color="text.secondary" sx={wrapTextSx}>{children}</Typography>
    </Paper>
);

const LoadingPanel = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

const PagePicker = ({ pages, value, onChange, t, includeAll = false, label }) => (
    <FormControl fullWidth size="small">
        <InputLabel>{label || t('contentStudio.page')}</InputLabel>
        <Select
            value={value}
            onChange={event => onChange(event.target.value)}
            label={label || t('contentStudio.page')}
        >
            {includeAll && <MenuItem value="">{t('contentStudio.allPages')}</MenuItem>}
            {pages.map(page => (
                <MenuItem key={page.id} value={page.id}>
                    {page.page_name || page.page_id}
                </MenuItem>
            ))}
        </Select>
    </FormControl>
);

function CalendarPanel({ pages, selectedPageId, locale, notify, t, refreshToken }) {
    const [data, setData] = useState({ publications: [], summary: {}, total: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [sourcesLoading, setSourcesLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [items, setItems] = useState([]);
    const [products, setProducts] = useState([]);
    const [form, setForm] = useState({
        linked_page_id: selectedPageId || '',
        source_type: 'item',
        source_id: '',
        scheduled_for: toLocalDateTimeInput(),
        message_override: '',
    });

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const result = await api.getPortalContentStudioPublications({
                ...(selectedPageId ? { linked_page_id: selectedPageId } : {}),
                limit: 150,
            });
            setData(result);
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [selectedPageId, t]);

    useEffect(() => { load(); }, [load, refreshToken]);

    const grouped = useMemo(() => {
        const groups = new Map();
        for (const publication of data.publications || []) {
            const date = new Date(publication.scheduled_for);
            const key = Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(publication);
        }
        return [...groups.entries()];
    }, [data.publications]);

    const openSchedule = async () => {
        setDialogOpen(true);
        setForm({
            linked_page_id: selectedPageId || pages[0]?.id || '',
            source_type: 'item',
            source_id: '',
            scheduled_for: toLocalDateTimeInput(),
            message_override: '',
        });
        try {
            setSourcesLoading(true);
            const [itemResult, productResult] = await Promise.all([
                api.getPortalContentStudioItems({ status: 'approved', limit: 100 }),
                api.getPortalContentStudioProducts({ limit: 100 }),
            ]);
            setItems(itemResult.items || []);
            setProducts(productResult.products || []);
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.sourcesLoadFailed'), 'error');
        } finally {
            setSourcesLoading(false);
        }
    };

    const schedule = async () => {
        if (!form.linked_page_id || !form.source_id || !form.scheduled_for) return;
        try {
            setSaving(true);
            await api.schedulePortalContentStudioPublication({
                linked_page_id: form.linked_page_id,
                scheduled_for: new Date(form.scheduled_for).toISOString(),
                ...(form.source_type === 'item'
                    ? { content_item_id: form.source_id }
                    : { product_id: form.source_id }),
                ...(form.message_override.trim() ? { message_override: form.message_override.trim() } : {}),
            });
            setDialogOpen(false);
            notify(t('contentStudio.messages.scheduled'), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.scheduleFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const mutatePublication = async (publication, action) => {
        try {
            if (action === 'retry') await api.retryPortalContentStudioPublication(publication.id);
            if (action === 'now') await api.publishPortalContentStudioPublicationNow(publication.id);
            if (action === 'cancel') await api.cancelPortalContentStudioPublication(publication.id);
            notify(t(`contentStudio.messages.${action}Success`), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.actionFailed'), 'error');
        }
    };

    return (
        <Box>
            <SectionHeading
                title={t('contentStudio.calendarTitle')}
                subtitle={t('contentStudio.calendarSubtitle')}
                action={(
                    <Button variant="contained" startIcon={<ScheduleIcon />} onClick={openSchedule} disabled={!pages.length}>
                        {t('contentStudio.schedulePost')}
                    </Button>
                )}
            />

            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' },
                gap: 1,
                mb: 2,
            }}>
                {['pending', 'processing', 'published', 'failed', 'cancelled'].map(status => (
                    <Paper key={status} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary">{statusLabel(t, status)}</Typography>
                        <Typography variant="h5" component="p" fontWeight={800}>{data.summary?.[status] || 0}</Typography>
                    </Paper>
                ))}
            </Box>

            {loading ? <LoadingPanel /> : error ? <Alert severity="error">{error}</Alert> : grouped.length === 0 ? (
                <EmptyPanel>{t('contentStudio.noPublications')}</EmptyPanel>
            ) : (
                <Stack spacing={2}>
                    {grouped.map(([day, publications]) => (
                        <Box key={day}>
                            <Typography variant="subtitle2" component="h3" color="text.secondary" sx={{ mb: 1 }}>
                                {day === 'unknown'
                                    ? t('contentStudio.unknownDate')
                                    : new Intl.DateTimeFormat(locale || 'ar-LY', { dateStyle: 'full' }).format(new Date(`${day}T12:00:00`))}
                            </Typography>
                            <Box sx={gridSx}>
                                {publications.map(publication => (
                                    <Card key={publication.id} variant="outlined" sx={{ minWidth: 0 }}>
                                        <CardContent>
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                                                <Box sx={{ minWidth: 0 }}>
                                                    <Typography fontWeight={800} sx={wrapTextSx}>
                                                        {publication.content_title || publication.product_name || publication.campaign_name || t('contentStudio.manualPost')}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={wrapTextSx}>
                                                        {publication.page_name} · {formatDateTime(publication.scheduled_for, locale)}
                                                    </Typography>
                                                </Box>
                                                <Chip size="small" color={statusColor(publication.status)} label={statusLabel(t, publication.status)} />
                                            </Box>
                                            <Typography variant="body2" sx={{
                                                ...wrapTextSx,
                                                display: '-webkit-box',
                                                WebkitLineClamp: 4,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                            }}>
                                                {publication.rendered_message}
                                            </Typography>
                                            {publication.error_message && (
                                                <Alert severity="error" sx={{ mt: 1, '& .MuiAlert-message': wrapTextSx }}>
                                                    {publication.error_message}
                                                </Alert>
                                            )}
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                                {t('contentStudio.attempts', { count: publication.attempts || 0 })}
                                            </Typography>
                                        </CardContent>
                                        {(publication.status === 'pending' || publication.status === 'failed') && (
                                            <CardActions sx={actionsSx}>
                                                {publication.status === 'failed' && (
                                                    <Button size="small" startIcon={<RefreshIcon />} onClick={() => mutatePublication(publication, 'retry')}>
                                                        {t('contentStudio.retry')}
                                                    </Button>
                                                )}
                                                {publication.status === 'pending' && (
                                                    <Button size="small" startIcon={<PublishIcon />} onClick={() => mutatePublication(publication, 'now')}>
                                                        {t('contentStudio.publishNow')}
                                                    </Button>
                                                )}
                                                <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => mutatePublication(publication, 'cancel')}>
                                                    {t('contentStudio.cancelPublication')}
                                                </Button>
                                            </CardActions>
                                        )}
                                    </Card>
                                ))}
                            </Box>
                        </Box>
                    ))}
                </Stack>
            )}

            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm" aria-labelledby="content-studio-schedule-title" slotProps={{ paper: dialogPaperProps }}>
                <DialogTitle id="content-studio-schedule-title">{t('contentStudio.schedulePost')}</DialogTitle>
                <DialogContent dividers>
                    {sourcesLoading ? <LoadingPanel /> : (
                        <Stack spacing={2} sx={{ pt: 0.5 }}>
                            <PagePicker pages={pages} value={form.linked_page_id} onChange={value => setForm(current => ({ ...current, linked_page_id: value }))} t={t} />
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('contentStudio.source')}</InputLabel>
                                <Select value={form.source_type} label={t('contentStudio.source')} onChange={event => setForm(current => ({ ...current, source_type: event.target.value, source_id: '' }))}>
                                    <MenuItem value="item">{t('contentStudio.library')}</MenuItem>
                                    <MenuItem value="product">{t('contentStudio.products')}</MenuItem>
                                </Select>
                            </FormControl>
                            <FormControl fullWidth size="small">
                                <InputLabel>{form.source_type === 'item' ? t('contentStudio.contentItem') : t('contentStudio.product')}</InputLabel>
                                <Select
                                    value={form.source_id}
                                    label={form.source_type === 'item' ? t('contentStudio.contentItem') : t('contentStudio.product')}
                                    onChange={event => setForm(current => ({ ...current, source_id: event.target.value }))}
                                >
                                    {(form.source_type === 'item' ? items : products).map(source => (
                                        <MenuItem key={source.id} value={source.id}>{source.title || source.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <TextField
                                fullWidth
                                type="datetime-local"
                                label={t('contentStudio.scheduledFor')}
                                value={form.scheduled_for}
                                onChange={event => setForm(current => ({ ...current, scheduled_for: event.target.value }))}
                                slotProps={{ inputLabel: { shrink: true } }}
                            />
                            <TextField
                                fullWidth
                                multiline
                                minRows={3}
                                label={t('contentStudio.messageOverride')}
                                helperText={t('contentStudio.messageOverrideHint')}
                                value={form.message_override}
                                onChange={event => setForm(current => ({ ...current, message_override: event.target.value }))}
                            />
                        </Stack>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
                    <Button variant="contained" onClick={schedule} disabled={saving || sourcesLoading || !form.linked_page_id || !form.source_id || !form.scheduled_for}>
                        {saving ? <CircularProgress size={20} /> : t('contentStudio.confirmSchedule')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

const emptyItemForm = linkedPageId => ({
    id: null,
    linked_page_id: linkedPageId || '',
    title: '',
    body: '',
    link_url: '',
    media_url: '',
    tags: '',
});

function LibraryPanel({ pages, selectedPageId, locale, notify, t, refreshToken }) {
    const [mode, setMode] = useState('items');
    const [items, setItems] = useState([]);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyItemForm(selectedPageId));

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            if (mode === 'items') {
                const result = await api.getPortalContentStudioItems({
                    ...(selectedPageId ? { linked_page_id: selectedPageId } : {}),
                    ...(status ? { status } : {}),
                    ...(search ? { search } : {}),
                    limit: 100,
                });
                setItems(result.items || []);
            } else {
                const result = await api.getPortalContentStudioProducts({
                    ...(search ? { search } : {}),
                    limit: 100,
                });
                setProducts(result.products || []);
                setCategories(result.categories || []);
            }
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [mode, search, selectedPageId, status, t]);

    useEffect(() => { load(); }, [load, refreshToken]);

    const openCreate = () => {
        setForm(emptyItemForm(selectedPageId));
        setDialogOpen(true);
    };

    const openEdit = item => {
        setForm({
            id: item.id,
            linked_page_id: item.linked_page_id || '',
            title: item.title || '',
            body: item.body || '',
            link_url: item.link_url || '',
            media_url: item.media_url || '',
            tags: joinCsv(item.tags),
        });
        setDialogOpen(true);
    };

    const save = async () => {
        if (!form.title.trim() || !form.body.trim()) return;
        try {
            setSaving(true);
            const payload = {
                linked_page_id: form.linked_page_id || null,
                title: form.title.trim(),
                body: form.body.trim(),
                link_url: form.link_url.trim() || null,
                media_url: form.media_url.trim() || null,
                tags: parseCsv(form.tags),
            };
            if (form.id) await api.updatePortalContentStudioItem(form.id, payload);
            else await api.createPortalContentStudioItem({ ...payload, kind: 'manual', status: 'draft' });
            setDialogOpen(false);
            notify(t('contentStudio.messages.itemSaved'), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.itemSaveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const actOnItem = async (item, action) => {
        try {
            if (action === 'approve') await api.approvePortalContentStudioItem(item.id);
            if (action === 'archive') await api.archivePortalContentStudioItem(item.id);
            notify(t(`contentStudio.messages.${action}Success`), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.actionFailed'), 'error');
        }
    };

    const createFromProduct = async product => {
        try {
            await api.createPortalContentStudioItemFromProduct(product.id, {
                linked_page_id: selectedPageId || null,
                title: product.name,
            });
            notify(t('contentStudio.messages.productConverted'), 'success');
            setMode('items');
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.productConvertFailed'), 'error');
        }
    };

    return (
        <Box>
            <SectionHeading
                title={t('contentStudio.libraryTitle')}
                subtitle={t('contentStudio.librarySubtitle')}
                action={mode === 'items' ? (
                    <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                        {t('contentStudio.newContent')}
                    </Button>
                ) : null}
            />
            <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
                <Tabs value={mode} onChange={(_, value) => setMode(value)} variant="scrollable" scrollButtons="auto">
                    <Tab value="items" icon={<LibraryIcon />} iconPosition="start" label={t('contentStudio.contentLibrary')} />
                    <Tab value="products" icon={<ProductIcon />} iconPosition="start" label={t('contentStudio.sharedProducts')} />
                </Tabs>
                <Divider />
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: mode === 'items' ? '2fr 1fr' : '1fr' },
                    gap: 1.5,
                    p: 1.5,
                }}>
                    <TextField size="small" label={t('contentStudio.search')} value={search} onChange={event => setSearch(event.target.value)} />
                    {mode === 'items' && (
                        <FormControl size="small" fullWidth>
                            <InputLabel>{t('contentStudio.statusLabel')}</InputLabel>
                            <Select value={status} label={t('contentStudio.statusLabel')} onChange={event => setStatus(event.target.value)}>
                                <MenuItem value="">{t('contentStudio.allStatuses')}</MenuItem>
                                {['draft', 'review', 'approved'].map(value => (
                                    <MenuItem key={value} value={value}>{statusLabel(t, value)}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                </Box>
            </Paper>

            {mode === 'products' && categories.length > 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    {t('contentStudio.productCategories', { categories: categories.join('، ') })}
                </Alert>
            )}

            {loading ? <LoadingPanel /> : error ? <Alert severity="error">{error}</Alert> : (mode === 'items' ? items : products).length === 0 ? (
                <EmptyPanel>{mode === 'items' ? t('contentStudio.noContentItems') : t('contentStudio.noProducts')}</EmptyPanel>
            ) : (
                <Box sx={gridSx}>
                    {mode === 'items' ? items.map(item => (
                        <Card key={item.id} variant="outlined" sx={{ minWidth: 0 }}>
                            {item.media_url && (
                                <Box
                                    component="img"
                                    src={item.media_url}
                                    alt=""
                                    sx={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                                />
                            )}
                            <CardContent>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={800} sx={wrapTextSx}>{item.title}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={wrapTextSx}>
                                            {item.page_name || t('contentStudio.allPages')} · {t(`contentStudio.kind.${item.kind}`)}
                                        </Typography>
                                    </Box>
                                    <Chip size="small" color={statusColor(item.status)} label={statusLabel(t, item.status)} />
                                </Box>
                                <Typography variant="body2" sx={{
                                    ...wrapTextSx,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 5,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}>
                                    {item.body}
                                </Typography>
                                {item.tags?.length > 0 && (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
                                        {item.tags.map(tag => <Chip key={tag} label={tag} size="small" variant="outlined" />)}
                                    </Box>
                                )}
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                    {formatDateTime(item.updated_at, locale)}
                                </Typography>
                            </CardContent>
                            <CardActions sx={actionsSx}>
                                <Button size="small" startIcon={<EditIcon />} onClick={() => openEdit(item)}>{t('common.edit')}</Button>
                                {item.status !== 'approved' && (
                                    <Button size="small" color="success" startIcon={<ApproveIcon />} onClick={() => actOnItem(item, 'approve')}>
                                        {t('contentStudio.approve')}
                                    </Button>
                                )}
                                <Button size="small" color="error" startIcon={<ArchiveIcon />} onClick={() => actOnItem(item, 'archive')}>
                                    {t('contentStudio.archive')}
                                </Button>
                            </CardActions>
                        </Card>
                    )) : products.map(product => (
                        <Card key={product.id} variant="outlined" sx={{ minWidth: 0 }}>
                            {product.image_url && (
                                <Box component="img" src={product.image_url} alt="" sx={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                            )}
                            <CardContent>
                                <Typography fontWeight={800} sx={wrapTextSx}>{product.name}</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{
                                    ...wrapTextSx,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    my: 1,
                                }}>
                                    {product.description || t('contentStudio.noDescription')}
                                </Typography>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                                    <Chip size="small" label={product.category || t('contentStudio.uncategorized')} />
                                    <Typography fontWeight={800}>{Number(product.price || 0).toLocaleString(locale || 'ar-LY')} {product.currency || 'LYD'}</Typography>
                                </Box>
                            </CardContent>
                            <CardActions sx={actionsSx}>
                                <Button variant="contained" size="small" startIcon={<LibraryIcon />} onClick={() => createFromProduct(product)}>
                                    {t('contentStudio.turnIntoPost')}
                                </Button>
                            </CardActions>
                        </Card>
                    ))}
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="md" aria-labelledby="content-studio-item-title" slotProps={{ paper: dialogPaperProps }}>
                <DialogTitle id="content-studio-item-title">{form.id ? t('contentStudio.editContent') : t('contentStudio.newContent')}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ pt: 0.5 }}>
                        <PagePicker
                            pages={pages}
                            value={form.linked_page_id}
                            onChange={value => setForm(current => ({ ...current, linked_page_id: value }))}
                            t={t}
                            includeAll
                            label={t('contentStudio.targetPage')}
                        />
                        <TextField fullWidth label={t('contentStudio.contentTitle')} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} />
                        <TextField fullWidth multiline minRows={7} label={t('contentStudio.body')} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                            <TextField fullWidth label={t('contentStudio.linkUrl')} value={form.link_url} onChange={event => setForm(current => ({ ...current, link_url: event.target.value }))} />
                            <TextField fullWidth label={t('contentStudio.mediaUrl')} value={form.media_url} onChange={event => setForm(current => ({ ...current, media_url: event.target.value }))} />
                        </Box>
                        <TextField fullWidth label={t('contentStudio.tags')} helperText={t('contentStudio.commaSeparated')} value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
                    <Button variant="contained" onClick={save} disabled={saving || !form.title.trim() || !form.body.trim()}>
                        {saving ? <CircularProgress size={20} /> : t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

const MAX_CAMPAIGN_POSTS = 500;
const CAMPAIGN_POST_IMPORT_BATCH_SIZE = 50;

const mergeFacebookPosts = (...groups) => {
    const posts = new Map();
    groups.flat().filter(Boolean).forEach(post => {
        const id = String(post.id || post.source_post_id || '').trim();
        if (id) posts.set(id, { ...posts.get(id), ...post, id });
    });
    return [...posts.values()];
};

const campaignPostSnapshot = item => ({
    id: item.source_post_id,
    message: item.body || item.title || '',
    full_picture: item.media_url || '',
    permalink_url: item.source_post_url || item.link_url || '',
    imported_status: item.status,
});

const campaignDateBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    const date = new Date(`${value}T${time}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function CampaignPostSelector({
    linkedPageId,
    locale,
    selectedPosts,
    onSelectedPostsChange,
    disabled,
    t,
}) {
    const [posts, setPosts] = useState(() => Object.values(selectedPosts));
    const [paging, setPaging] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [bulkMode, setBulkMode] = useState('');
    const [error, setError] = useState('');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [truncated, setTruncated] = useState(false);

    const loadFirstPage = useCallback(async () => {
        if (!linkedPageId) return;
        try {
            setLoading(true);
            setError('');
            setTruncated(false);
            const response = await api.getPortalFbPosts(linkedPageId, { limit: 50 });
            setPosts(current => mergeFacebookPosts(Object.values(selectedPosts), current, response.posts || []));
            setPaging(response.paging || null);
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.campaignPostsLoadFailed'));
        } finally {
            setLoading(false);
        }
    }, [linkedPageId, selectedPosts, t]);

    useEffect(() => {
        setPosts(Object.values(selectedPosts));
        setPaging(null);
        setRangeStart('');
        setRangeEnd('');
        if (linkedPageId) loadFirstPage();
        // selectedPosts are intentionally read only when the page changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkedPageId]);

    const loadMore = async () => {
        const after = paging?.cursors?.after;
        if (!after || !linkedPageId) return;
        try {
            setLoadingMore(true);
            setError('');
            const response = await api.getPortalFbPosts(linkedPageId, { limit: 50, after });
            setPosts(current => mergeFacebookPosts(current, response.posts || []));
            setPaging(response.paging || null);
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.campaignPostsLoadFailed'));
        } finally {
            setLoadingMore(false);
        }
    };

    const fetchAllPosts = async ({ since = null, until = null } = {}) => {
        let after = null;
        let result = [];
        let nextPaging = null;
        const seenCursors = new Set();
        do {
            const response = await api.getPortalFbPosts(linkedPageId, {
                limit: 50,
                ...(after ? { after } : {}),
                ...(since ? { since } : {}),
                ...(until ? { until } : {}),
            });
            result = mergeFacebookPosts(result, response.posts || []).slice(0, MAX_CAMPAIGN_POSTS);
            nextPaging = response.paging || null;
            const nextCursor = nextPaging?.cursors?.after || null;
            if (!nextCursor || seenCursors.has(nextCursor) || result.length >= MAX_CAMPAIGN_POSTS) break;
            seenCursors.add(nextCursor);
            after = nextCursor;
        } while (result.length < MAX_CAMPAIGN_POSTS);
        return {
            posts: result,
            truncated: result.length >= MAX_CAMPAIGN_POSTS && Boolean(nextPaging?.cursors?.after),
        };
    };

    const selectBulk = async mode => {
        if (!linkedPageId) return;
        const since = mode === 'range' ? campaignDateBoundary(rangeStart) : null;
        const until = mode === 'range' ? campaignDateBoundary(rangeEnd, true) : null;
        if (mode === 'range' && (!since || !until || new Date(since) > new Date(until))) {
            setError(t('contentStudio.messages.invalidCampaignPostRange'));
            return;
        }
        try {
            setBulkMode(mode);
            setError('');
            const result = await fetchAllPosts({ since, until });
            if (!result.posts.length) {
                setError(t('contentStudio.messages.noCampaignPostsInSelection'));
                return;
            }
            const combined = mergeFacebookPosts(Object.values(selectedPosts), result.posts);
            setPosts(current => mergeFacebookPosts(current, result.posts));
            onSelectedPostsChange(Object.fromEntries(
                combined
                    .slice(0, MAX_CAMPAIGN_POSTS)
                    .map(post => [String(post.id), post]),
            ));
            setPaging(null);
            setTruncated(result.truncated || combined.length > MAX_CAMPAIGN_POSTS);
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.campaignPostsLoadFailed'));
        } finally {
            setBulkMode('');
        }
    };

    const togglePost = post => {
        const id = String(post.id);
        const next = { ...selectedPosts };
        if (next[id]) delete next[id];
        else if (Object.keys(next).length < MAX_CAMPAIGN_POSTS) next[id] = post;
        else {
            setTruncated(true);
            return;
        }
        onSelectedPostsChange(next);
    };

    const selectLoaded = () => onSelectedPostsChange(Object.fromEntries(
        mergeFacebookPosts(Object.values(selectedPosts), posts)
            .slice(0, MAX_CAMPAIGN_POSTS)
            .map(post => [String(post.id), post]),
    ));

    return (
        <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 }, minWidth: 0 }}>
            <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={800}>{t('contentStudio.campaignPostsTitle')}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={wrapTextSx}>{t('contentStudio.campaignPostsHint')}</Typography>
                    </Box>
                    <Chip color={Object.keys(selectedPosts).length ? 'primary' : 'default'} label={t('contentStudio.selectedPostsCount', { count: Object.keys(selectedPosts).length })} />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, gap: 1 }}>
                    <TextField
                        size="small"
                        type="date"
                        label={t('contentStudio.postsFromDate')}
                        value={rangeStart}
                        onChange={event => setRangeStart(event.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <TextField
                        size="small"
                        type="date"
                        label={t('contentStudio.postsToDate')}
                        value={rangeEnd}
                        onChange={event => setRangeEnd(event.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <Button variant="outlined" onClick={() => selectBulk('range')} disabled={disabled || Boolean(bulkMode)} sx={{ minWidth: 150 }}>
                        {bulkMode === 'range' ? <CircularProgress size={20} /> : t('contentStudio.selectDateRangePosts')}
                    </Button>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained" onClick={() => selectBulk('all')} disabled={disabled || Boolean(bulkMode)}>
                        {bulkMode === 'all' ? <CircularProgress size={18} color="inherit" /> : t('contentStudio.selectAllPagePosts')}
                    </Button>
                    <Button size="small" onClick={selectLoaded} disabled={disabled || !posts.length}>{t('contentStudio.selectLoadedPosts')}</Button>
                    <Button size="small" color="inherit" onClick={() => onSelectedPostsChange({})} disabled={disabled || !Object.keys(selectedPosts).length}>{t('contentStudio.clearPostSelection')}</Button>
                </Box>

                {error && <Alert severity="error">{error}</Alert>}
                {truncated && <Alert severity="warning">{t('contentStudio.campaignPostLimit', { count: MAX_CAMPAIGN_POSTS })}</Alert>}
                {loading ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box> : posts.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('contentStudio.noCampaignPosts')}</Typography>
                ) : (
                    <Box sx={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 1, pr: 0.5 }}>
                        {posts.map(post => {
                            const id = String(post.id);
                            const message = String(post.message || post.attachments?.data?.[0]?.description || t('facebookContent.noText'));
                            return (
                                <Paper key={id} variant="outlined" sx={{ p: 1, minWidth: 0 }}>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: post.full_picture ? 'auto minmax(0, 1fr) 64px' : 'auto minmax(0, 1fr)', gap: 1, alignItems: 'center' }}>
                                        <Checkbox
                                            checked={Boolean(selectedPosts[id])}
                                            onChange={() => togglePost(post)}
                                            disabled={disabled}
                                            inputProps={{ 'aria-label': t('contentStudio.selectCampaignPost') }}
                                        />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" sx={{ ...wrapTextSx, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{message}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {post.created_time ? formatDateTime(post.created_time, locale) : t('contentStudio.importedCampaignPost')}
                                            </Typography>
                                        </Box>
                                        {post.full_picture && <Box component="img" src={post.full_picture} alt="" sx={{ width: 64, height: 56, objectFit: 'cover', borderRadius: 1 }} />}
                                    </Box>
                                </Paper>
                            );
                        })}
                    </Box>
                )}
                {paging?.cursors?.after && (
                    <Button size="small" variant="outlined" onClick={loadMore} disabled={loadingMore || disabled}>
                        {loadingMore ? <CircularProgress size={18} /> : t('facebookContent.loadMore')}
                    </Button>
                )}
            </Stack>
        </Paper>
    );
}

const emptyCampaignForm = linkedPageId => ({
    id: null,
    linked_page_id: linkedPageId || '',
    name: '',
    description: '',
    source_mode: 'library',
    rotation_mode: 'sequential',
    product_category: '',
    product_template: '{name}\n\n{description}\n\n{price} {currency}\n{url}',
    timezone: 'Africa/Tripoli',
    allowed_days: [0, 1, 2, 3, 4, 5, 6],
    schedule_times: '09:00, 17:00',
    no_repeat_days: 14,
    max_posts_per_day: 2,
    approval_required: true,
    status: 'draft',
});

function CampaignsPanel({ pages, selectedPageId, locale, notify, t, refreshToken }) {
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyCampaignForm(selectedPageId));
    const [selectedPosts, setSelectedPosts] = useState({});
    const [preservedContentItemIds, setPreservedContentItemIds] = useState([]);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const result = await api.getPortalContentStudioCampaigns({
                ...(selectedPageId ? { linked_page_id: selectedPageId } : {}),
                limit: 100,
            });
            setCampaigns(result.campaigns || []);
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [selectedPageId, t]);

    useEffect(() => { load(); }, [load, refreshToken]);

    const openCreate = () => {
        setForm(emptyCampaignForm(selectedPageId || pages[0]?.id));
        setSelectedPosts({});
        setPreservedContentItemIds([]);
        setDialogOpen(true);
    };

    const openEdit = campaign => {
        const selectedContentItems = campaign.selected_content_items || [];
        const postItems = selectedContentItems.filter(item => item.source_post_id);
        setForm({
            id: campaign.id,
            linked_page_id: campaign.linked_page_id,
            name: campaign.name || '',
            description: campaign.description || '',
            source_mode: campaign.source_mode,
            rotation_mode: campaign.rotation_mode,
            product_category: campaign.product_category || '',
            product_template: campaign.product_template || '',
            timezone: campaign.timezone || 'Africa/Tripoli',
            allowed_days: campaign.allowed_days || [],
            schedule_times: joinCsv(campaign.schedule_times),
            no_repeat_days: campaign.no_repeat_days,
            max_posts_per_day: campaign.max_posts_per_day,
            approval_required: Boolean(campaign.approval_required),
            status: campaign.status,
        });
        setSelectedPosts(Object.fromEntries(postItems.map(item => [
            String(item.source_post_id),
            campaignPostSnapshot(item),
        ])));
        setPreservedContentItemIds(selectedContentItems
            .filter(item => !item.source_post_id)
            .map(item => item.id));
        setDialogOpen(true);
    };

    const changeCampaignPage = value => {
        setForm(current => ({ ...current, linked_page_id: value }));
        setSelectedPosts({});
        setPreservedContentItemIds([]);
    };

    const toggleDay = day => {
        setForm(current => ({
            ...current,
            allowed_days: current.allowed_days.includes(day)
                ? current.allowed_days.filter(value => value !== day)
                : [...current.allowed_days, day].sort((a, b) => a - b),
        }));
    };

    const save = async () => {
        if (!form.name.trim() || !form.linked_page_id || !form.allowed_days.length || !parseCsv(form.schedule_times).length) return;
        try {
            setSaving(true);
            let contentItemIds = form.source_mode === 'products'
                ? []
                : [...preservedContentItemIds];
            const selectedPostValues = Object.values(selectedPosts);
            if (form.source_mode !== 'products' && selectedPostValues.length) {
                const drafts = selectedPostValues.map(post => {
                    const draft = buildFacebookPostLibraryDraft(post, form.linked_page_id, {
                        fallbackTitle: t('facebookContent.defaultPostName'),
                    });
                    if (!draft.body) draft.body = draft.title;
                    return draft;
                });
                const importedItems = [];
                for (let index = 0; index < drafts.length; index += CAMPAIGN_POST_IMPORT_BATCH_SIZE) {
                    const imported = await api.createPortalContentStudioItemsFromPosts({
                        linked_page_id: form.linked_page_id,
                        approve: form.approval_required,
                        posts: drafts.slice(index, index + CAMPAIGN_POST_IMPORT_BATCH_SIZE),
                    });
                    importedItems.push(...(imported.items || []));
                }
                contentItemIds = [...new Set([
                    ...contentItemIds,
                    ...importedItems.map(item => item.id),
                ])];
            }
            const payload = {
                ...form,
                name: form.name.trim(),
                description: form.description.trim() || null,
                product_category: form.product_category.trim() || null,
                product_template: form.product_template.trim() || null,
                schedule_times: parseCsv(form.schedule_times),
                no_repeat_days: Number(form.no_repeat_days),
                max_posts_per_day: Number(form.max_posts_per_day),
                content_item_ids: contentItemIds,
            };
            delete payload.id;
            if (form.id) await api.updatePortalContentStudioCampaign(form.id, payload);
            else await api.createPortalContentStudioCampaign(payload);
            setDialogOpen(false);
            notify(t('contentStudio.messages.campaignSaved'), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.campaignSaveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const action = async (campaign, type) => {
        try {
            if (type === 'toggle') await api.togglePortalContentStudioCampaign(campaign.id);
            if (type === 'run') await api.runPortalContentStudioCampaignNow(campaign.id);
            if (type === 'complete') await api.completePortalContentStudioCampaign(campaign.id);
            notify(t(`contentStudio.messages.campaign${type === 'run' ? 'Run' : type === 'toggle' ? 'Toggled' : 'Completed'}`), 'success');
            load();
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.actionFailed'), 'error');
        }
    };

    const dayLabels = [
        t('contentStudio.days.sunday'),
        t('contentStudio.days.monday'),
        t('contentStudio.days.tuesday'),
        t('contentStudio.days.wednesday'),
        t('contentStudio.days.thursday'),
        t('contentStudio.days.friday'),
        t('contentStudio.days.saturday'),
    ];

    return (
        <Box>
            <SectionHeading
                title={t('contentStudio.campaignsTitle')}
                subtitle={t('contentStudio.campaignsSubtitle')}
                action={(
                    <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!pages.length}>
                        {t('contentStudio.newCampaign')}
                    </Button>
                )}
            />
            {loading ? <LoadingPanel /> : error ? <Alert severity="error">{error}</Alert> : campaigns.length === 0 ? (
                <EmptyPanel>{t('contentStudio.noCampaigns')}</EmptyPanel>
            ) : (
                <Box sx={gridSx}>
                    {campaigns.map(campaign => (
                        <Card key={campaign.id} variant="outlined" sx={{ minWidth: 0 }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography fontWeight={800} sx={wrapTextSx}>{campaign.name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={wrapTextSx}>{campaign.page_name}</Typography>
                                    </Box>
                                    <Chip size="small" color={statusColor(campaign.status)} label={statusLabel(t, campaign.status)} />
                                </Box>
                                {campaign.description && <Typography variant="body2" color="text.secondary" sx={{ ...wrapTextSx, mt: 1 }}>{campaign.description}</Typography>}
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
                                    <Chip size="small" variant="outlined" label={t(`contentStudio.sourceMode.${campaign.source_mode}`)} />
                                    <Chip size="small" variant="outlined" label={t(`contentStudio.rotationMode.${campaign.rotation_mode}`)} />
                                    <Chip size="small" variant="outlined" label={t('contentStudio.dailyLimitValue', { count: campaign.max_posts_per_day })} />
                                    <Chip size="small" variant="outlined" label={t('contentStudio.noRepeatValue', { count: campaign.no_repeat_days })} />
                                </Box>
                                <Divider sx={{ my: 1.5 }} />
                                <Typography variant="body2">
                                    {t('contentStudio.scheduleSummary', {
                                        times: (campaign.schedule_times || []).join('، '),
                                        days: (campaign.allowed_days || []).map(day => dayLabels[day]).join('، '),
                                    })}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                    {t('contentStudio.nextRun')}: {formatDateTime(campaign.next_run_at, locale)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    {t('contentStudio.publishedFailed', { published: campaign.published_count || 0, failed: campaign.failed_count || 0 })}
                                </Typography>
                                {campaign.last_error && <Alert severity="warning" sx={{ mt: 1, '& .MuiAlert-message': wrapTextSx }}>{campaign.last_error}</Alert>}
                            </CardContent>
                            {campaign.status !== 'completed' && (
                                <CardActions sx={actionsSx}>
                                    <Tooltip title={t('common.edit')}>
                                        <IconButton size="small" onClick={() => openEdit(campaign)} aria-label={t('common.edit')}><EditIcon /></IconButton>
                                    </Tooltip>
                                    <Button size="small" startIcon={campaign.status === 'active' ? <PauseIcon /> : <PlayIcon />} onClick={() => action(campaign, 'toggle')}>
                                        {campaign.status === 'active' ? t('contentStudio.pause') : t('contentStudio.activate')}
                                    </Button>
                                    <Button size="small" color="primary" startIcon={<PublishIcon />} onClick={() => action(campaign, 'run')}>
                                        {t('contentStudio.runNow')}
                                    </Button>
                                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => action(campaign, 'complete')}>
                                        {t('contentStudio.endCampaign')}
                                    </Button>
                                </CardActions>
                            )}
                        </Card>
                    ))}
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="md" aria-labelledby="content-studio-campaign-title" slotProps={{ paper: dialogPaperProps }}>
                <DialogTitle id="content-studio-campaign-title">{form.id ? t('contentStudio.editCampaign') : t('contentStudio.newCampaign')}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ pt: 0.5 }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                            <TextField fullWidth label={t('contentStudio.campaignName')} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                            <PagePicker pages={pages} value={form.linked_page_id} onChange={changeCampaignPage} t={t} />
                        </Box>
                        <TextField fullWidth multiline minRows={2} label={t('contentStudio.description')} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('contentStudio.source')}</InputLabel>
                                <Select value={form.source_mode} label={t('contentStudio.source')} onChange={event => setForm(current => ({ ...current, source_mode: event.target.value }))}>
                                    {['library', 'products', 'mixed'].map(value => <MenuItem key={value} value={value}>{t(`contentStudio.sourceMode.${value}`)}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('contentStudio.rotation')}</InputLabel>
                                <Select value={form.rotation_mode} label={t('contentStudio.rotation')} onChange={event => setForm(current => ({ ...current, rotation_mode: event.target.value }))}>
                                    {['sequential', 'random'].map(value => <MenuItem key={value} value={value}>{t(`contentStudio.rotationMode.${value}`)}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('contentStudio.initialStatus')}</InputLabel>
                                <Select value={form.status} label={t('contentStudio.initialStatus')} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>
                                    {['draft', 'active', 'paused'].map(value => <MenuItem key={value} value={value}>{statusLabel(t, value)}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Box>
                        {(form.source_mode === 'library' || form.source_mode === 'mixed') && (
                            <CampaignPostSelector
                                key={`${form.id || 'new'}:${form.linked_page_id}`}
                                linkedPageId={form.linked_page_id}
                                locale={locale}
                                selectedPosts={selectedPosts}
                                onSelectedPostsChange={setSelectedPosts}
                                disabled={saving}
                                t={t}
                            />
                        )}
                        {(form.source_mode === 'products' || form.source_mode === 'mixed') && (
                            <>
                                <TextField fullWidth label={t('contentStudio.productCategory')} value={form.product_category} onChange={event => setForm(current => ({ ...current, product_category: event.target.value }))} />
                                <TextField
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    label={t('contentStudio.productTemplate')}
                                    helperText={t('contentStudio.productTemplateHint')}
                                    value={form.product_template}
                                    onChange={event => setForm(current => ({ ...current, product_template: event.target.value }))}
                                />
                            </>
                        )}
                        <Box>
                            <Typography variant="subtitle2" component="p" sx={{ mb: 0.5 }}>{t('contentStudio.allowedDays')}</Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {dayLabels.map((label, day) => (
                                    <FormControlLabel
                                        key={label}
                                        control={<Checkbox size="small" checked={form.allowed_days.includes(day)} onChange={() => toggleDay(day)} />}
                                        label={label}
                                        sx={{ m: 0, px: 0.5 }}
                                    />
                                ))}
                            </Box>
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.5fr 1fr 1fr' }, gap: 2 }}>
                            <TextField fullWidth label={t('contentStudio.scheduleTimes')} helperText={t('contentStudio.commaSeparatedTimes')} value={form.schedule_times} onChange={event => setForm(current => ({ ...current, schedule_times: event.target.value }))} />
                            <TextField fullWidth type="number" label={t('contentStudio.dailyLimit')} value={form.max_posts_per_day} onChange={event => setForm(current => ({ ...current, max_posts_per_day: event.target.value }))} inputProps={{ min: 1, max: 24 }} />
                            <TextField fullWidth type="number" label={t('contentStudio.noRepeatDays')} value={form.no_repeat_days} onChange={event => setForm(current => ({ ...current, no_repeat_days: event.target.value }))} inputProps={{ min: 0, max: 365 }} />
                        </Box>
                        <TextField fullWidth label={t('contentStudio.timezone')} value={form.timezone} onChange={event => setForm(current => ({ ...current, timezone: event.target.value }))} />
                        <FormControlLabel
                            control={<Switch checked={form.approval_required} onChange={event => setForm(current => ({ ...current, approval_required: event.target.checked }))} />}
                            label={t('contentStudio.approvedOnly')}
                        />
                        {(form.source_mode === 'library' || form.source_mode === 'mixed') && Object.keys(selectedPosts).length > 0 && (
                            <Alert severity="info">{form.approval_required
                                ? t('contentStudio.selectedPostsWillBeApproved')
                                : t('contentStudio.selectedPostsWillRemainDrafts')}</Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
                    <Button
                        variant="contained"
                        onClick={save}
                        disabled={saving || !form.name.trim() || !form.linked_page_id || !form.allowed_days.length || !parseCsv(form.schedule_times).length}
                    >
                        {saving ? <CircularProgress size={20} /> : t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function AiPanel({ pages, selectedPageId, readiness, notify, t, refreshToken }) {
    const [products, setProducts] = useState([]);
    const [input, setInput] = useState('');
    const [action, setAction] = useState('generate');
    const [variants, setVariants] = useState(3);
    const [productId, setProductId] = useState('');
    const [pageId, setPageId] = useState(selectedPageId || '');
    const [createItems, setCreateItems] = useState(true);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    useEffect(() => {
        setPageId(selectedPageId || '');
    }, [selectedPageId]);

    useEffect(() => {
        api.getPortalContentStudioProducts({ limit: 100 })
            .then(response => setProducts(response.products || []))
            .catch(() => setProducts([]));
    }, [refreshToken]);

    const generate = async () => {
        if (!input.trim() && !productId) return;
        try {
            setLoading(true);
            setResult(null);
            const response = await api.generatePortalContentStudioAi({
                linked_page_id: pageId || null,
                product_id: productId || null,
                input_text: input.trim(),
                action,
                variants: Number(variants),
                create_items: createItems,
            });
            setResult(response);
            notify(
                createItems
                    ? t('contentStudio.messages.aiGeneratedAndSaved', { count: response.created_item_ids?.length || 0 })
                    : t('contentStudio.messages.aiGenerated'),
                'success',
            );
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.aiFailed'), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box>
            <SectionHeading title={t('contentStudio.aiTitle')} subtitle={t('contentStudio.aiSubtitle')} />
            {!readiness?.ai?.configured && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {t('contentStudio.aiNotConfigured')}
                </Alert>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.9fr) minmax(0, 1.1fr)' }, gap: 2 }}>
                <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
                    <Stack spacing={2}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                            <PagePicker pages={pages} value={pageId} onChange={setPageId} t={t} includeAll label={t('contentStudio.voiceScope')} />
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('contentStudio.aiAction')}</InputLabel>
                                <Select value={action} label={t('contentStudio.aiAction')} onChange={event => setAction(event.target.value)}>
                                    <MenuItem value="generate">{t('contentStudio.aiActions.generate')}</MenuItem>
                                    <MenuItem value="rewrite">{t('contentStudio.aiActions.rewrite')}</MenuItem>
                                    <MenuItem value="variants">{t('contentStudio.aiActions.variants')}</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                        <FormControl fullWidth size="small">
                            <InputLabel>{t('contentStudio.optionalProduct')}</InputLabel>
                            <Select value={productId} label={t('contentStudio.optionalProduct')} onChange={event => setProductId(event.target.value)}>
                                <MenuItem value="">{t('contentStudio.noProduct')}</MenuItem>
                                {products.map(product => <MenuItem key={product.id} value={product.id}>{product.name}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField
                            fullWidth
                            multiline
                            minRows={8}
                            label={action === 'rewrite' ? t('contentStudio.textToRewrite') : t('contentStudio.contentBrief')}
                            placeholder={t('contentStudio.contentBriefPlaceholder')}
                            value={input}
                            onChange={event => setInput(event.target.value)}
                        />
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 2, alignItems: 'center' }}>
                            <TextField type="number" label={t('contentStudio.variantsCount')} value={variants} onChange={event => setVariants(event.target.value)} inputProps={{ min: 1, max: 5 }} />
                            <FormControlLabel
                                control={<Switch checked={createItems} onChange={event => setCreateItems(event.target.checked)} />}
                                label={t('contentStudio.saveToReview')}
                            />
                        </Box>
                        <Alert severity="info" icon={<AutoAwesomeIcon />}>
                            {t('contentStudio.aiCreditNote')}
                        </Alert>
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <AutoAwesomeIcon />}
                            disabled={loading || !readiness?.ai?.configured || (!input.trim() && !productId)}
                            onClick={generate}
                        >
                            {loading ? t('contentStudio.generating') : t('contentStudio.generate')}
                        </Button>
                    </Stack>
                </Paper>
                <Box sx={{ minWidth: 0 }}>
                    {!result ? (
                        <EmptyPanel>{t('contentStudio.noAiResult')}</EmptyPanel>
                    ) : (
                        <Stack spacing={2}>
                            {(result.variants || []).map((variant, index) => (
                                <Card key={`${variant.title}-${index}`} variant="outlined" sx={{ minWidth: 0 }}>
                                    <CardContent>
                                        <Chip size="small" color="primary" variant="outlined" label={t('contentStudio.variant', { number: index + 1 })} sx={{ mb: 1 }} />
                                        <Typography fontWeight={800} sx={wrapTextSx}>{variant.title}</Typography>
                                        <Typography variant="body2" sx={{ ...wrapTextSx, my: 1.5 }}>{variant.body}</Typography>
                                        {variant.cta && <Typography variant="body2" color="primary" fontWeight={700} sx={wrapTextSx}>{variant.cta}</Typography>}
                                        {variant.hashtags?.length > 0 && (
                                            <Typography variant="caption" color="text.secondary" sx={{ ...wrapTextSx, display: 'block', mt: 1 }}>
                                                {variant.hashtags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}
                                            </Typography>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </Stack>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function SettingsPanel({ pages, selectedPageId, notify, t, refreshToken }) {
    const [scope, setScope] = useState(selectedPageId ? 'page' : 'tenant');
    const [pageId, setPageId] = useState(selectedPageId || pages[0]?.id || '');
    const [settings, setSettings] = useState(null);
    const [isOverride, setIsOverride] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (selectedPageId) setPageId(selectedPageId);
    }, [selectedPageId]);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.getPortalContentStudioSettings(scope === 'page' ? pageId : null);
            setSettings(response.settings);
            setIsOverride(response.is_page_override);
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.settingsLoadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, [notify, pageId, scope, t]);

    useEffect(() => {
        if (scope === 'tenant' || pageId) load();
    }, [load, refreshToken, scope, pageId]);

    const update = (field, value) => setSettings(current => ({ ...current, [field]: value }));

    const save = async () => {
        if (!settings) return;
        try {
            setSaving(true);
            const response = await api.updatePortalContentStudioSettings({
                ...settings,
                linked_page_id: scope === 'page' ? pageId : null,
            });
            setSettings(response.settings);
            setIsOverride(response.is_page_override);
            notify(t('contentStudio.messages.settingsSaved'), 'success');
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.settingsSaveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const resetOverride = async () => {
        try {
            setSaving(true);
            const response = await api.resetPortalContentStudioPageSettings(pageId);
            setSettings(response.settings);
            setIsOverride(false);
            notify(t('contentStudio.messages.overrideReset'), 'success');
        } catch (requestError) {
            notify(requestError.message || t('contentStudio.messages.overrideResetFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const dayLabels = [
        t('contentStudio.days.sunday'),
        t('contentStudio.days.monday'),
        t('contentStudio.days.tuesday'),
        t('contentStudio.days.wednesday'),
        t('contentStudio.days.thursday'),
        t('contentStudio.days.friday'),
        t('contentStudio.days.saturday'),
    ];

    if (loading || !settings) return <LoadingPanel />;

    return (
        <Box>
            <SectionHeading title={t('contentStudio.settingsTitle')} subtitle={t('contentStudio.settingsSubtitle')} />
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={3}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>{t('contentStudio.settingsScope')}</InputLabel>
                            <Select value={scope} label={t('contentStudio.settingsScope')} onChange={event => setScope(event.target.value)}>
                                <MenuItem value="tenant">{t('contentStudio.tenantDefaults')}</MenuItem>
                                <MenuItem value="page" disabled={!pages.length}>{t('contentStudio.pageOverride')}</MenuItem>
                            </Select>
                        </FormControl>
                        {scope === 'page' && <PagePicker pages={pages} value={pageId} onChange={setPageId} t={t} />}
                    </Box>
                    {scope === 'page' && (
                        <Alert severity={isOverride ? 'info' : 'success'}>
                            {isOverride ? t('contentStudio.overrideActive') : t('contentStudio.inheritingDefaults')}
                        </Alert>
                    )}
                    <Divider />
                    <Typography variant="subtitle1" component="h3" fontWeight={800}>{t('contentStudio.brandAndWriting')}</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                        <TextField label={t('contentStudio.language')} value={settings.language} onChange={event => update('language', event.target.value)} />
                        <TextField label={t('contentStudio.tone')} value={settings.tone} onChange={event => update('tone', event.target.value)} />
                        <TextField label={t('contentStudio.audience')} value={settings.audience} onChange={event => update('audience', event.target.value)} />
                        <TextField label={t('contentStudio.defaultCta')} value={settings.default_cta} onChange={event => update('default_cta', event.target.value)} />
                    </Box>
                    <TextField multiline minRows={4} label={t('contentStudio.brandVoice')} helperText={t('contentStudio.brandVoiceHint')} value={settings.brand_voice} onChange={event => update('brand_voice', event.target.value)} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                        <TextField label={t('contentStudio.requiredTerms')} helperText={t('contentStudio.commaSeparated')} value={joinCsv(settings.required_terms)} onChange={event => update('required_terms', parseCsv(event.target.value))} />
                        <TextField label={t('contentStudio.bannedTerms')} helperText={t('contentStudio.commaSeparated')} value={joinCsv(settings.banned_terms)} onChange={event => update('banned_terms', parseCsv(event.target.value))} />
                        <TextField label={t('contentStudio.defaultHashtags')} helperText={t('contentStudio.commaSeparated')} value={joinCsv(settings.hashtags)} onChange={event => update('hashtags', parseCsv(event.target.value))} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>{t('contentStudio.emojiLevel')}</InputLabel>
                            <Select value={settings.emoji_level} label={t('contentStudio.emojiLevel')} onChange={event => update('emoji_level', event.target.value)}>
                                {['none', 'light', 'medium'].map(value => <MenuItem key={value} value={value}>{t(`contentStudio.emoji.${value}`)}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>{t('contentStudio.approvalMode')}</InputLabel>
                            <Select value={settings.approval_mode} label={t('contentStudio.approvalMode')} onChange={event => update('approval_mode', event.target.value)}>
                                {['manual', 'approved_only', 'automatic'].map(value => <MenuItem key={value} value={value}>{t(`contentStudio.approval.${value}`)}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Box>
                    <Divider />
                    <Typography variant="subtitle1" component="h3" fontWeight={800}>{t('contentStudio.safetyAndSchedule')}</Typography>
                    <Box>
                        <Typography variant="subtitle2" component="p" sx={{ mb: 0.5 }}>{t('contentStudio.allowedDays')}</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {dayLabels.map((label, day) => (
                                <FormControlLabel
                                    key={label}
                                    control={(
                                        <Checkbox
                                            size="small"
                                            checked={settings.allowed_days.includes(day)}
                                            onChange={() => update(
                                                'allowed_days',
                                                settings.allowed_days.includes(day)
                                                    ? settings.allowed_days.filter(value => value !== day)
                                                    : [...settings.allowed_days, day].sort((a, b) => a - b),
                                            )}
                                        />
                                    )}
                                    label={label}
                                    sx={{ m: 0, px: 0.5 }}
                                />
                            ))}
                        </Box>
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 2 }}>
                        <TextField type="time" label={t('contentStudio.postingStart')} value={settings.posting_start_time} onChange={event => update('posting_start_time', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                        <TextField type="time" label={t('contentStudio.postingEnd')} value={settings.posting_end_time} onChange={event => update('posting_end_time', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                        <TextField type="number" label={t('contentStudio.dailyLimit')} value={settings.daily_post_limit} onChange={event => update('daily_post_limit', Number(event.target.value))} inputProps={{ min: 1, max: 24 }} />
                        <TextField type="number" label={t('contentStudio.noRepeatDays')} value={settings.no_repeat_days} onChange={event => update('no_repeat_days', Number(event.target.value))} inputProps={{ min: 0, max: 365 }} />
                        <TextField type="number" label={t('contentStudio.autoPauseFailures')} value={settings.auto_pause_failures} onChange={event => update('auto_pause_failures', Number(event.target.value))} inputProps={{ min: 1, max: 20 }} />
                    </Box>
                    <TextField label={t('contentStudio.timezone')} value={settings.timezone} onChange={event => update('timezone', event.target.value)} />
                    <FormControlLabel
                        control={<Switch checked={settings.ai_enabled} onChange={event => update('ai_enabled', event.target.checked)} />}
                        label={t('contentStudio.enableAi')}
                    />
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' }, justifyContent: 'flex-end', gap: 1 }}>
                        {scope === 'page' && isOverride && (
                            <Button color="error" variant="outlined" onClick={resetOverride} disabled={saving}>
                                {t('contentStudio.resetOverride')}
                            </Button>
                        )}
                        <Button variant="contained" onClick={save} disabled={saving || !settings.allowed_days.length}>
                            {saving ? <CircularProgress size={20} /> : t('contentStudio.saveSettings')}
                        </Button>
                    </Box>
                </Stack>
            </Paper>
        </Box>
    );
}

export default function FacebookContentStudioWorkspace() {
    const { locale, t } = useLanguage();
    const [section, setSection] = useState('calendar');
    const [pages, setPages] = useState([]);
    const [selectedPageId, setSelectedPageId] = useState('');
    const [readiness, setReadiness] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const notify = useCallback((message, severity = 'success') => {
        setSnackbar({ open: true, message, severity });
    }, []);

    const loadBase = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const [pageResult, readinessResult] = await Promise.all([
                api.getPortalPages(),
                api.getPortalContentStudioReadiness(),
            ]);
            const activePages = (Array.isArray(pageResult) ? pageResult : []).filter(page => page.is_active !== false);
            setPages(activePages);
            setReadiness(readinessResult);
            setSelectedPageId(current => (
                activePages.some(page => page.id === current)
                    ? current
                    : (activePages[0]?.id || '')
            ));
        } catch (requestError) {
            setError(requestError.message || t('contentStudio.messages.readinessFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { loadBase(); }, [loadBase]);

    const refresh = async () => {
        await loadBase();
        setRefreshToken(value => value + 1);
    };

    const tabs = [
        ['calendar', <CalendarIcon key="calendar" />, t('contentStudio.tabs.calendar')],
        ['library', <LibraryIcon key="library" />, t('contentStudio.tabs.library')],
        ['campaigns', <CampaignIcon key="campaigns" />, t('contentStudio.tabs.campaigns')],
        ['ai', <AutoAwesomeIcon key="ai" />, t('contentStudio.tabs.ai')],
        ['settings', <SettingsIcon key="settings" />, t('contentStudio.tabs.settings')],
        ['live', <FacebookIcon key="live" />, t('contentStudio.tabs.live')],
    ];

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, minWidth: 0 }}>
            <Box sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'stretch', md: 'flex-start' },
                gap: 2,
                mb: 2.5,
            }}>
                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{
                            width: 46,
                            height: 46,
                            borderRadius: 3,
                            display: 'grid',
                            placeItems: 'center',
                            color: 'common.white',
                            background: 'linear-gradient(145deg, #1877f2, #7c3aed)',
                            flexShrink: 0,
                        }}>
                            <TuneIcon />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                            <PageTitle variant="h4" fontWeight={900} sx={wrapTextSx}>{t('contentStudio.title')}</PageTitle>
                            <Typography variant="body2" color="text.secondary" sx={wrapTextSx}>{t('contentStudio.subtitle')}</Typography>
                        </Box>
                    </Box>
                </Box>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={loading}>
                    {t('common.refresh')}
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!loading && !pages.length && (
                <Alert severity="warning" sx={{ mb: 2 }}>{t('contentStudio.noLinkedPages')}</Alert>
            )}

            {readiness && (
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' },
                    gap: 1,
                    mb: 2,
                }}>
                    {[
                        ['linkedPages', readiness.linked_pages, <FacebookIcon key="pages" />],
                        ['productsMetric', readiness.products, <ProductIcon key="products" />],
                        ['libraryMetric', readiness.content_items, <LibraryIcon key="library" />],
                        ['campaignsMetric', readiness.active_campaigns, <CampaignIcon key="campaigns" />],
                        ['failuresMetric', readiness.failed_publications, <RefreshIcon key="failures" />],
                    ].map(([label, value, icon]) => (
                        <Paper key={label} variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: label === 'failuresMetric' && value ? 'error.main' : 'primary.main' }}>
                                {icon}
                                <Typography variant="h5" component="p" fontWeight={900}>{value || 0}</Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={wrapTextSx}>{t(`contentStudio.${label}`)}</Typography>
                        </Paper>
                    ))}
                </Box>
            )}

            <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 0.35fr) minmax(0, 1fr)' },
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                }}>
                    <PagePicker pages={pages} value={selectedPageId} onChange={setSelectedPageId} t={t} label={t('contentStudio.filterPage')} />
                    <Tabs
                        value={section}
                        onChange={(_, value) => setSection(value)}
                        variant="scrollable"
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        aria-label={t('contentStudio.navigation')}
                        sx={{ minWidth: 0 }}
                    >
                        {tabs.map(([value, icon, label]) => (
                            <Tab key={value} value={value} icon={icon} iconPosition="start" label={label} sx={{ minHeight: 48, whiteSpace: 'nowrap' }} />
                        ))}
                    </Tabs>
                </Box>
            </Paper>

            {loading ? <LoadingPanel /> : (
                <Box sx={{ minWidth: 0 }}>
                    {section === 'calendar' && <CalendarPanel pages={pages} selectedPageId={selectedPageId} locale={locale} notify={notify} t={t} refreshToken={refreshToken} />}
                    {section === 'library' && <LibraryPanel pages={pages} selectedPageId={selectedPageId} locale={locale} notify={notify} t={t} refreshToken={refreshToken} />}
                    {section === 'campaigns' && <CampaignsPanel pages={pages} selectedPageId={selectedPageId} locale={locale} notify={notify} t={t} refreshToken={refreshToken} />}
                    {section === 'ai' && <AiPanel pages={pages} selectedPageId={selectedPageId} readiness={readiness} notify={notify} t={t} refreshToken={refreshToken} />}
                    {section === 'settings' && <SettingsPanel pages={pages} selectedPageId={selectedPageId} notify={notify} t={t} refreshToken={refreshToken} />}
                    {section === 'live' && <TenantContentManager embedded />}
                </Box>
            )}

            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={() => setSnackbar(current => ({ ...current, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snackbar.severity}
                    variant="filled"
                    onClose={() => setSnackbar(current => ({ ...current, open: false }))}
                    sx={{ width: '100%', '& .MuiAlert-message': wrapTextSx }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
