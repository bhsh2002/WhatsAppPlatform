import React from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { workspaceActionAvailable, workspaceLabel } from './connectionsDataPresentation';

const Summary = ({ rows = [] }) => <Box component="dl" sx={{ m: 0, '& dt': { fontWeight: 700 }, '& dd': { m: 0, mb: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>{rows.map(row => <React.Fragment key={row.label}><Typography component="dt" variant="body2">{row.label}</Typography><Typography component="dd" variant="body2"><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography></React.Fragment>)}</Box>;
const requestLabel = (state, ar) => ({ pending: ar ? 'بانتظار المراجعة' : 'Awaiting review', approved: ar ? 'اعتُمد الاقتراح الحالي' : 'Current proposal approved', rejected: ar ? 'رُفض الاقتراح الحالي' : 'Current proposal rejected' }[state] || (ar ? 'لم تُتحقق حالة الطلب' : 'Request state unverified'));

const WorkspaceAccessRequests = ({ requests = [], detail = null, detailLoading = false, verified = false, held = true, busy = false,
    onDetail, onCloseDetail, onAction, language = 'ar' }) => {
    const ar = language === 'ar';
    return <Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'طلبات الربط والصلاحيات الحالية' : 'Connection requests and current access'}</Typography>
        {verified && !requests.length && <Typography variant="body2" color="text.secondary">{ar ? 'لا توجد طلبات ظاهرة لهذا النشاط.' : 'No requests are visible for this activity.'}</Typography>}
        {verified && requests.map(request => <Card key={request.key} component="article" variant="outlined"><CardContent><Stack spacing={1.5}>
            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography component="h3" fontWeight={700}>{workspaceLabel(request.label, ar ? 'طلب ربط' : 'Connection request')}</Typography><Chip size="small" label={requestLabel(request.state, ar)} /></Stack>
            {request.changedSinceEffective && <Typography variant="body2">{ar ? 'هذا اقتراح لتغيير الإعداد السابق. راجع الإعداد النافذ والاقتراح الحالي كلًا على حدة.' : 'This proposes a change to the earlier setup. Review the effective setup and current proposal separately.'}</Typography>}
            {request.effectiveStateLabel && <Typography variant="body2">{request.effectiveStateLabel}</Typography>}
            <Box><Button onClick={() => onDetail?.(request.key)} disabled={busy}>{ar ? 'تفاصيل الطلب ومراجعته' : 'Request details and review'}</Button></Box>
        </Stack></CardContent></Card>)}
        <Dialog open={verified && (Boolean(detail) || detailLoading)} onClose={onCloseDetail} fullWidth maxWidth="md" aria-labelledby="workspace-access-request-title">
            <DialogTitle id="workspace-access-request-title">{workspaceLabel(detail?.label, ar ? 'تفاصيل طلب الربط' : 'Connection request details')}</DialogTitle>
            <DialogContent><Stack spacing={2}>
                {detailLoading && <Typography>{ar ? 'جارٍ التحقق من الطلب والصلاحية الحالية…' : 'Checking the request and current permissions…'}</Typography>}
                {detail && <>
                    <Chip size="small" label={requestLabel(detail.state, ar)} sx={{ alignSelf: 'flex-start' }} />
                    <Stack direction={{ xs: 'column', md: 'row' }} gap={3}>
                        <Box sx={{ flex: 1, minWidth: 0 }}><Typography component="h3" fontWeight={800} sx={{ mb: 1 }}>{ar ? 'الاقتراح الحالي' : 'Current proposal'}</Typography><Summary rows={detail.proposedSummary} />
                            {detail.state !== 'approved' && <Typography variant="body2" color="text.secondary">{ar ? 'لم يُعتمد هذا الاقتراح، ولا يضيف صلاحية وصول.' : 'This proposal is not approved and adds no access.'}</Typography>}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}><Typography component="h3" fontWeight={800} sx={{ mb: 1 }}>{ar ? 'الإعداد المعتمد المسجل وحالته' : 'Recorded approved setup and its state'}</Typography>
                            {detail.effectiveSummary ? <Summary rows={detail.effectiveSummary} /> : <Typography variant="body2">{ar ? 'لا يوجد إعداد معتمد نافذ لهذا الطلب.' : 'No approved effective setup exists for this request.'}</Typography>}
                            {detail.effectiveStateLabel && <Typography variant="body2">{detail.effectiveStateLabel}</Typography>}
                        </Box>
                    </Stack>
                    {detail.changedSinceEffective && <Alert severity="info">{ar ? 'اعتماد الإعداد السابق لا يعتمد التعديل الحالي، ورفض التعديل لا يسحب الوصول السابق تلقائيًا.' : 'Earlier setup approval does not approve the current change, and rejecting the change does not automatically revoke earlier access.'}</Alert>}
                    {(detail.removedFields?.length > 0 || detail.removedPeople?.length > 0) && <Alert severity="warning">
                        <Typography fontWeight={700}>{ar ? 'سيُسحب الوصول التالي عند اعتماد الاقتراح الحالي:' : 'Approving the current proposal will remove this access:'}</Typography>
                        {detail.removedFields?.length > 0 && <Typography variant="body2">{ar ? 'البيانات: ' : 'Data: '}{detail.removedFields.join(ar ? '، ' : ', ')}</Typography>}
                        {detail.removedPeople?.length > 0 && <Typography variant="body2">{ar ? 'الأشخاص: ' : 'People: '}{detail.removedPeople.join(ar ? '، ' : ', ')}</Typography>}
                    </Alert>}
                    {detail.message && <Typography variant="body2">{detail.message}</Typography>}
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>{(detail.actions || []).map(action => <Box key={action.key}><Button variant={action.key === 'approve' ? 'contained' : 'outlined'}
                        disabled={!workspaceActionAvailable(action, { verified, held, busy })} onClick={() => onAction?.(detail.key, action.key)}>{workspaceLabel(action.label, ar ? 'متابعة' : 'Continue')}</Button>
                        {action.enabled !== true && action.reason && <Typography variant="caption" display="block">{action.reason}</Typography>}
                    </Box>)}</Stack>
                </>}
            </Stack></DialogContent>
            <DialogActions><Button onClick={onCloseDetail} disabled={busy}>{ar ? 'إغلاق' : 'Close'}</Button></DialogActions>
        </Dialog>
    </Stack>;
};

export default WorkspaceAccessRequests;
