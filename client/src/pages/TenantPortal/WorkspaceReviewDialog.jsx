import React from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { workspaceReviewSummaryIsValid } from './connectionsDataPresentation';
import { workspaceReviewIsCurrent } from './connectionsDataRuntime';

const WorkspaceReviewDialog = ({ review, context, held = true, busy = false, submitted = false, onSubmit, onClose, language = 'ar' }) => {
    const ar = language === 'ar';
    return <Dialog open={Boolean(review) && context?.verified === true} onClose={() => { if (!busy && !submitted) onClose?.(); }} fullWidth maxWidth="sm" aria-labelledby="workspace-operation-review-title">
        <DialogTitle id="workspace-operation-review-title">{ar ? 'راجع الطلب قبل تقديمه' : 'Review before submitting'}</DialogTitle>
        <DialogContent><Stack spacing={2}>
            <Box component="dl" sx={{ m: 0, '& dt': { fontWeight: 700 }, '& dd': { m: 0, mb: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } }}>
                {(workspaceReviewSummaryIsValid(review?.summary) ? review.summary : []).map(row => <React.Fragment key={row.label}><Typography component="dt" variant="body2">{row.label}</Typography><Typography component="dd" variant="body2"><bdi dir={/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? 'ltr' : 'auto'}>{row.value}</bdi></Typography></React.Fragment>)}
            </Box>
            {review?.message && <Alert severity="info">{review.message}</Alert>}
            {(review?.removedFields?.length > 0 || review?.removedPeople?.length > 0) && <Alert severity="warning"><Typography fontWeight={700}>{ar ? 'سيُسحب الوصول التالي عند اعتماد التغيير:' : 'Approval will remove this access:'}</Typography>
                {review.removedFields?.length > 0 && <Typography>{ar ? 'البيانات: ' : 'Data: '}{review.removedFields.join(ar ? '، ' : ', ')}</Typography>}
                {review.removedPeople?.length > 0 && <Typography>{ar ? 'الأشخاص: ' : 'People: '}{review.removedPeople.join(ar ? '، ' : ', ')}</Typography>}
            </Alert>}
            {review?.valid_until && <Typography variant="caption">{ar ? 'تنتهي هذه المراجعة في: ' : 'This review expires at: '}<bdi dir="ltr">{review.valid_until}</bdi></Typography>}
            {(held || submitted) && <Alert severity="warning">{ar ? 'افحص نتيجة العملية السابقة قبل تقديم طلب جديد. لا يُعاد إرسال الطلب تلقائيًا.' : 'Check the earlier outcome before submitting a new request. Requests are never automatically resent.'}</Alert>}
        </Stack></DialogContent>
        <DialogActions><Button onClick={onClose} disabled={busy || submitted}>{ar ? 'العودة للتعديل' : 'Back to editing'}</Button><Button variant="contained" onClick={onSubmit} disabled={busy || submitted || held || !workspaceReviewIsCurrent(review, context)}>{review?.submitLabel || (ar ? 'تقديم الطلب المراجع' : 'Submit reviewed request')}</Button></DialogActions>
    </Dialog>;
};

export default WorkspaceReviewDialog;
