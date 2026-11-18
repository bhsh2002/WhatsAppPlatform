import React from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { workspaceActionAvailable, workspaceAvailabilityLabel, workspaceLabel } from './connectionsDataPresentation';

const WorkspaceCapabilityCards = ({ capabilities = [], verified = false, held = false, busy = false, onAction, onNextAction, onRefresh, language = 'ar' }) => {
    const ar = language === 'ar';
    return <Stack spacing={2}>
        <Typography component="h2" variant="h6" fontWeight={800}>{ar ? 'ما الذي يمكنك عمله؟' : 'What can you do?'}</Typography>
        {!capabilities.length && <Alert severity="info" action={onRefresh ? <Button color="inherit" onClick={onRefresh} disabled={busy}>{ar ? 'التحقق من الحالة' : 'Check status'}</Button> : null}>
            {ar ? 'لم تُتحقق الإمكانات المتاحة لهذا النشاط بعد.' : 'Available capabilities for this activity have not been verified yet.'}
        </Alert>}
        {capabilities.map(capability => <Card key={capability.key} variant="outlined" component="article">
            <CardContent><Stack spacing={1.5}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                    <Typography component="h3" fontWeight={800}>{workspaceLabel(capability.label, ar ? 'إمكانية تحتاج تحققًا' : 'Capability needs verification')}</Typography>
                    {(capability.availability || capability.stateLabel) && <Chip size="small" variant="outlined" label={verified ? (capability.availability ? workspaceAvailabilityLabel(capability.availability.state, language) : capability.stateLabel) : (ar ? 'لم تُتحقق الحالة' : 'State unverified')} />}
                </Stack>
                {capability.description && <Typography variant="body2" color="text.secondary">{capability.description}</Typography>}
                {verified && capability.availability?.message && <Typography variant="body2">{capability.availability.message}</Typography>}
                {(verified ? capability.reasons || [] : [{ message: ar ? 'تحقق من حسابك لعرض المتطلبات الحالية لهذا النشاط.' : 'Verify your account to see the current requirements for this activity.' }]).map((reason, index) => <Typography key={reason.key || index} variant="body2">{reason.message}</Typography>)}
                {!capability.availability && !capability.ready && !capability.reasons?.length && <Typography variant="body2" color="text.secondary">{ar ? 'يلزم التحقق من المتطلبات الحالية قبل استخدام هذه الإمكانية.' : 'Check the current requirements before using this capability.'}</Typography>}
                {capability.availability?.next_action && onNextAction && <Box><Button variant="outlined" disabled={!verified || busy} onClick={() => onNextAction(capability.key, capability.availability.next_action.code)}>{workspaceLabel(capability.availability.next_action.label, ar ? 'عرض الخطوة التالية' : 'View next step')}</Button></Box>}
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                    {(capability.actions || []).map(action => <Box key={action.key}>
                        {action.stateLabel && <Typography variant="body2" sx={{ mb: 0.5 }}>{verified ? action.stateLabel : (ar ? 'لم تُتحقق حالة هذا الإجراء' : 'Action state unverified')}</Typography>}
                        <Button variant={action.primary ? 'contained' : 'outlined'} disabled={!workspaceActionAvailable(action, { verified, held, busy })} onClick={() => onAction?.(capability.key, action.key)}>
                            {workspaceLabel(action.label, ar ? 'متابعة الإعداد' : 'Continue setup')}
                        </Button>
                        {action.enabled !== true && <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>{action.reason || (ar ? 'هذا الإجراء غير متاح حاليًا.' : 'This action is currently unavailable.')}</Typography>}
                    </Box>)}
                </Stack>
            </Stack></CardContent>
        </Card>)}
    </Stack>;
};

export default WorkspaceCapabilityCards;
