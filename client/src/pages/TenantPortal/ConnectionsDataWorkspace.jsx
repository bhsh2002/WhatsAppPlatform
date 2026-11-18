import React, { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import GuidedDataConnection from './GuidedDataConnection';
import WorkspaceCapabilityCards from './WorkspaceCapabilityCards';
import WorkspaceSharedRecords from './WorkspaceSharedRecords';
import WorkspaceCommandStatus from './WorkspaceCommandStatus';
import WorkspaceAccessRequests from './WorkspaceAccessRequests';
import { workspaceActionAvailable, workspaceLabel } from './connectionsDataPresentation';

// A view layer only. The platform adapter supplies authenticated context,
// current allowed actions and callbacks backed by the published Core contract.
const ConnectionsDataWorkspace = ({ context = {}, connection = {}, capabilities = {}, sharedData = {}, operations = {}, accessRequests = {}, onConnect,
    actions = [], onWorkspaceAction, onRefresh, refreshing = false, activeTab, onTabChange, language = 'ar' }) => {
    const ar = language === 'ar';
    const [localTab, setLocalTab] = useState('connection');
    const tab = activeTab || localTab;
    const verified = context.verified === true;
    return <Stack spacing={3}>
        <Box><Typography component="h1" variant="h4" fontWeight={900}>{ar ? 'الربط والبيانات' : 'Connections & data'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{ar ? 'اختر كيف يتعاون نشاطك مع المنصات الأخرى، وتابع بياناتك وصلاحيات الوصول إليها.' : 'Choose how your activity works with other platforms, and manage its data and access.'}</Typography>
        </Box>
        <Card component="section" aria-label={ar ? 'الحساب والنشاط الحالي' : 'Current account and activity'}><CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
                <Stack spacing={1}>
                    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography fontWeight={800}>{verified ? workspaceLabel(context.organizationLabel, ar ? 'المؤسسة الحالية' : 'Current organization') : (ar ? 'المؤسسة لم تُتحقق بعد' : 'Organization not verified yet')}</Typography><Chip size="small" color={verified ? 'success' : 'default'} label={context.stateLabel || (verified ? (ar ? 'الحساب متحقق' : 'Account verified') : (ar ? 'يلزم ربط الحساب' : 'Account connection needed'))} /></Stack>
                    {verified && <Typography variant="body2">{ar ? 'تعمل باسم: ' : 'Working as: '}{workspaceLabel(context.actorLabel, ar ? 'حسابك الحالي' : 'Your current account')}</Typography>}
                    {verified && context.activityLabel && <Typography variant="body2">{workspaceLabel(context.activityLabel, ar ? 'النشاط الحالي' : 'Current activity')}{context.branchLabel ? ` · ${workspaceLabel(context.branchLabel, '')}` : ''}{context.warehouseLabel ? ` · ${workspaceLabel(context.warehouseLabel, '')}` : ''}</Typography>}
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems="flex-start">
                    {context.connect?.enabled === true && onConnect && <Button variant="contained" onClick={onConnect} disabled={refreshing}>{workspaceLabel(context.connect.label, ar ? 'ربط حساب المركز' : 'Connect your center account')}</Button>}
                    {onRefresh && <Button variant="outlined" onClick={onRefresh} disabled={refreshing}>{ar ? 'تحديث الحالة' : 'Refresh status'}</Button>}
                </Stack>
            </Stack>
            {(!verified || context.connect?.enabled === true) && <Alert severity="info" sx={{ mt: 2 }}>{context.reason || (ar ? 'اربط حسابك ليُعرض اسم المؤسسة والأنشطة التي يمكنك الوصول إليها.' : 'Connect your account to see your organization and the activities you can access.')}</Alert>}
        </CardContent></Card>
        {actions.length > 0 && <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>{actions.map(action => <Box key={action.key}>
            <Button variant="outlined" disabled={!workspaceActionAvailable(action, { verified, held: connection.held, busy: refreshing })} onClick={() => onWorkspaceAction?.(action.key)}>{action.key === 'activity.select'
                ? (ar ? 'استخدام هذا النشاط' : 'Use this activity') : workspaceLabel(action.label, ar ? 'متابعة الإعداد' : 'Continue setup')}</Button>
            {action.enabled !== true && action.reason && <Typography variant="caption" display="block">{action.reason}</Typography>}
        </Box>)}</Stack>}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}><Tabs value={tab} onChange={(_event, value) => { if (onTabChange) onTabChange(value); else setLocalTab(value); }} variant="scrollable" allowScrollButtonsMobile aria-label={ar ? 'أقسام الربط والبيانات' : 'Connections and data sections'}>
            <Tab value="connection" id="workspace-connection-tab" aria-controls="workspace-connection-panel" label={ar ? 'إعداد الربط' : 'Connection setup'} />
            <Tab value="data" id="workspace-data-tab" aria-controls="workspace-data-panel" label={ar ? 'البيانات المشتركة' : 'Shared data'} />
            <Tab value="capabilities" id="workspace-capabilities-tab" aria-controls="workspace-capabilities-panel" label={ar ? 'الإمكانات المتاحة' : 'Capabilities'} />
            <Tab value="operations" id="workspace-operations-tab" aria-controls="workspace-operations-panel" label={ar ? 'طلبات التغيير' : 'Change requests'} />
        </Tabs></Box>
        {tab === 'connection' && <Box role="tabpanel" id="workspace-connection-panel" aria-labelledby="workspace-connection-tab">{verified
            ? <Stack spacing={3}><GuidedDataConnection key={context.viewKey} {...connection} viewKey={context.viewKey} verified language={language} /><WorkspaceAccessRequests {...accessRequests} verified language={language} /></Stack>
            : <Alert severity="info">{ar ? 'ستظهر الأنشطة والحسابات والبيانات المتاحة بعد التحقق من ربط حسابك.' : 'Activities, accounts and available data appear after your account connection is verified.'}</Alert>}</Box>}
        {tab === 'data' && <Box role="tabpanel" id="workspace-data-panel" aria-labelledby="workspace-data-tab"><WorkspaceSharedRecords key={context.viewKey} {...sharedData} verified={verified} language={language} /></Box>}
        {tab === 'capabilities' && <Box role="tabpanel" id="workspace-capabilities-panel" aria-labelledby="workspace-capabilities-tab"><WorkspaceCapabilityCards {...capabilities} verified={verified} language={language} /></Box>}
        {tab === 'operations' && <Box role="tabpanel" id="workspace-operations-panel" aria-labelledby="workspace-operations-tab"><WorkspaceCommandStatus key={context.viewKey} {...operations} verified={verified} language={language} /></Box>}
    </Stack>;
};

export default ConnectionsDataWorkspace;
