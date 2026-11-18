import React, { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { workspaceActionAvailable, workspaceLabel, workspaceRecordsCanBrowse } from './connectionsDataPresentation';

const WorkspaceSharedRecords = ({ records = [], verified = false, loading = false, held = false, query = '', onQueryChange,
    onSearch, onDetail, onAction, browseAction = null, createAction = null, onCreate, detailRecord, detailLoading = false, onCloseDetail, emptyMessage = '', language = 'ar' }) => {
    const ar = language === 'ar';
    const [detailKey, setDetailKey] = useState(null);
    const controlledDetail = detailRecord !== undefined;
    const canBrowse = workspaceRecordsCanBrowse({ browseAction }, verified);
    const detail = canBrowse ? (controlledDetail ? detailRecord : records.find(record => record.key === detailKey)) : null;
    const closeDetail = () => { setDetailKey(null); onCloseDetail?.(); };
    const actionContext = { verified, held, busy: loading };

    return <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
            <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'البيانات المشتركة' : 'Shared data'}</Typography>
            {createAction && <Box><Button variant="contained" disabled={!workspaceActionAvailable(createAction, actionContext)} onClick={onCreate}>{workspaceLabel(createAction.label, ar ? 'إضافة منتج' : 'Create product')}</Button>
                {verified && createAction.enabled !== true && createAction.reason && <Typography variant="caption" display="block" color="text.secondary">{createAction.reason}</Typography>}
            </Box>}
        </Stack>
        <Box component="form" onSubmit={event => { event.preventDefault(); if (canBrowse && !loading) onSearch?.(); }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                <TextField label={ar ? 'ابحث بالاسم أو رمز المنتج' : 'Search by name or product code'} value={query} onChange={event => { setDetailKey(null); onQueryChange?.(event.target.value); }} disabled={loading || !canBrowse} fullWidth inputProps={{ maxLength: 255 }} />
                <Button type="submit" variant="outlined" disabled={loading || !canBrowse}>{ar ? 'بحث' : 'Search'}</Button>
            </Stack>
        </Box>
        {!verified && <Alert severity="info">{ar ? 'نتحقق من حقك في عرض بيانات هذا النشاط قبل إظهار النتائج.' : 'Your access to this activity is checked before results are shown.'}</Alert>}
        {verified && !canBrowse && <Alert severity="info">{browseAction?.reason || (ar ? 'تصفح المنتجات غير متاح ضمن الحالة الحالية لهذا النشاط.' : 'Product browsing is unavailable with the current activity state.')}</Alert>}
        {canBrowse && !loading && !records.length && <Alert severity="info">{emptyMessage || (ar ? 'لا توجد نتائج ضمن البيانات المسموحة لهذا الحساب.' : 'No results are visible within the data allowed for this account.')}</Alert>}
        {canBrowse && records.map(record => <Card key={record.key} variant="outlined" component="article"><CardContent>
            <Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap"><Typography component="h3" fontWeight={800}>{workspaceLabel(record.label, ar ? 'منتج مشترك' : 'Shared product')}</Typography>
                    {record.stateLabel && <Chip size="small" label={record.stateLabel} />}{record.freshnessLabel && <Chip size="small" variant="outlined" label={record.freshnessLabel} />}
                </Stack>
                <Typography variant="body2" color="text.secondary">{ar ? 'المصدر: ' : 'Source: '}{workspaceLabel(record.sourceLabel, ar ? 'لم يُتحقق اسم المصدر' : 'Source name unverified')}</Typography>
                {record.summary && <Typography variant="body2">{record.summary}</Typography>}
                <Box><Button onClick={() => { if (!controlledDetail) setDetailKey(record.key); onDetail?.(record.key); }} disabled={loading}>{ar ? 'التفاصيل ومصدر البيانات' : 'Details and data source'}</Button></Box>
            </Stack>
        </CardContent></Card>)}
        <Dialog open={canBrowse && (Boolean(detail) || detailLoading)} onClose={closeDetail} fullWidth maxWidth="md" aria-labelledby="workspace-record-title">
            <DialogTitle id="workspace-record-title">{workspaceLabel(detail?.label, ar ? 'تفاصيل المنتج' : 'Product details')}</DialogTitle>
            <DialogContent dividers><Stack spacing={2}>
                {detailLoading && <Typography>{ar ? 'جارٍ التحقق من تفاصيل المصدر…' : 'Checking source details…'}</Typography>}
                <Typography variant="body2">{ar ? 'مصدر هذا السجل: ' : 'This record comes from: '}{workspaceLabel(detail?.sourceLabel, ar ? 'اسم المصدر غير متاح' : 'Source name unavailable')}</Typography>
                {detail?.freshnessLabel && <Alert severity={detail.stale === true ? 'warning' : 'info'}>{detail.freshnessLabel}{detail.freshnessDescription ? ` — ${detail.freshnessDescription}` : ''}</Alert>}
                {(detail?.fields || []).map(field => <Box key={field.key} sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography component="h3" variant="subtitle2" fontWeight={800}>{workspaceLabel(field.label, ar ? 'بيان متاح' : 'Available field')}</Typography>
                    <Typography variant="body1" sx={{ my: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field.displayValue}</Typography>
                    <Typography variant="caption" color="text.secondary">{ar ? 'المرجع المعتمد: ' : 'Authoritative source: '}{workspaceLabel(field.sourceLabel, ar ? 'لم يُتحقق المرجع' : 'Source not verified')}</Typography>
                </Box>)}
                {(detail?.actions || []).map(action => <Box key={action.key}>
                    <Button variant="outlined" disabled={!workspaceActionAvailable(action, actionContext)} onClick={() => onAction?.(detail.key, action.key)}>{workspaceLabel(action.label, ar ? 'متابعة' : 'Continue')}</Button>
                    {action.enabled !== true && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{action.reason || (ar ? 'هذا الإجراء غير متاح لهذا السجل حاليًا.' : 'This action is currently unavailable for this record.')}</Typography>}
                </Box>)}
            </Stack></DialogContent>
            <DialogActions><Button onClick={closeDetail}>{ar ? 'إغلاق' : 'Close'}</Button></DialogActions>
        </Dialog>
    </Stack>;
};

export default WorkspaceSharedRecords;
