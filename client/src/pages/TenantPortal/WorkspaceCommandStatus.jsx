import React from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { workspaceActionAvailable, workspaceLabel } from './connectionsDataPresentation';
import { workspaceCommandResultActions, workspaceCommandStatus } from './workspaceCommandPresentation';

const WorkspaceCommandStatus = ({ commands = [], verified = false, held = false, busy = false, onAction, language = 'ar' }) => {
    const ar = language === 'ar';
    return <Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'طلبات التغيير ونتائجها' : 'Change requests and outcomes'}</Typography>
        {!verified && <Alert severity="info">{ar ? 'تحقق من الحساب لعرض الطلبات الحالية ونتائجها.' : 'Verify the account to view current requests and outcomes.'}</Alert>}
        {verified && !commands.length && <Typography color="text.secondary">{ar ? 'لا توجد طلبات تغيير ظاهرة لهذا النشاط.' : 'No change requests are visible for this activity.'}</Typography>}
        {verified && commands.map(command => {
            const status = workspaceCommandStatus(command, language);
            const progress = command.progress;
            const hasProgress = progress && ['total', 'completed', 'failed', 'pending', 'unknown'].every(field => Number.isSafeInteger(progress[field]) && progress[field] >= 0)
                && progress.total === progress.completed + progress.failed + progress.pending + progress.unknown;
            return <Card key={command.key} variant="outlined" component="article"><CardContent><Stack spacing={1.5}>
                <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography component="h3" fontWeight={800}>{workspaceLabel(command.label, ar ? 'طلب تغيير' : 'Change request')}</Typography><Chip size="small" label={status.stateLabel} /></Stack>
                <Typography variant="body2">{ar ? 'المرجع المعتمد: ' : 'Authoritative source: '}{workspaceLabel(command.sourceLabel, ar ? 'اسم المصدر لم يُتحقق' : 'Source name unverified')}</Typography>
                <Typography variant="body2">{status.sourceLabel}</Typography>
                <Typography variant="body2">{status.projectionLabel}</Typography>
                {hasProgress && <Typography variant="body2">{ar
                    ? `الإجمالي: ${progress.total} · نُفّذ: ${progress.completed} · تعذّر: ${progress.failed} · بانتظار التنفيذ: ${progress.pending} · غير محسوم: ${progress.unknown}`
                    : `Total: ${progress.total} · Applied: ${progress.completed} · Failed: ${progress.failed} · Pending: ${progress.pending} · Unresolved: ${progress.unknown}`}</Typography>}
                {command.pending?.scheduled_for && <Typography variant="body2">{ar ? 'موعد التنفيذ المسجل: ' : 'Recorded execution time: '}<bdi dir="ltr">{command.pending.scheduled_for}</bdi></Typography>}
                {command.message && <Typography variant="body2">{command.message}</Typography>}
                {status.unresolved && <Alert severity="warning">{ar ? 'تحقق من نتيجة هذا الطلب قبل بدء تغيير آخر. فحص الحالة لا يعيد إرسال الطلب.' : 'Check this request’s outcome before starting another change. Checking status does not resubmit it.'}</Alert>}
                {command.updated_at && <Typography variant="caption" color="text.secondary">{ar ? 'آخر تحديث: ' : 'Last updated: '}<bdi dir="ltr">{command.updated_at}</bdi></Typography>}
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>{workspaceCommandResultActions(command).map(action => <Button key={action.format} component="a" href={action.href} download variant="outlined" disabled={busy}>{action.label}</Button>)}</Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>{(command.actions || []).map(action => <Box key={action.key}>
                    <Button variant="outlined" disabled={!workspaceActionAvailable(action, { verified, held, busy })} onClick={() => onAction?.(command.key, action.key)}>{workspaceLabel(action.label, ar ? 'عرض الطلب' : 'View request')}</Button>
                    {action.enabled !== true && action.reason && <Typography variant="caption" display="block">{action.reason}</Typography>}
                </Box>)}</Stack>
            </Stack></CardContent></Card>;
        })}
    </Stack>;
};

export default WorkspaceCommandStatus;
