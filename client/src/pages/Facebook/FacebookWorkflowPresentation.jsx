import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoAwesome as AiIcon,
  CampaignOutlined as CampaignIcon,
  ContentCopyOutlined as CopyIcon,
  DeleteOutline as DeleteIcon,
  EditOutlined as EditIcon,
  HistoryOutlined as HistoryIcon,
  Inventory2Outlined as ProductIcon,
  LibraryAddOutlined as LibraryIcon,
  MoreHoriz as MoreIcon,
  ScheduleOutlined as ScheduleIcon,
} from '@mui/icons-material';

import { FacebookPostProductDialog } from './FacebookContentPresentation';

const wrapSx = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

const closeMenuAction = (close, action) => () => {
  close();
  action();
};

export const FacebookPostToolsButton = ({ post, t, workflows }) => {
  const [anchor, setAnchor] = useState(null);
  const close = () => setAnchor(null);
  const busy = Boolean(workflows.quickAction);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={busy ? <CircularProgress size={14} /> : <MoreIcon />}
        onClick={event => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
      >
        {t('facebookContent.postTools')}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem disabled>
          <Typography variant="overline">{t('facebookContent.aiPostTools')}</Typography>
        </MenuItem>
        {['rewrite', 'variants', 'improve_cta', 'hashtags', 'shorten', 'tone'].map(action => (
          <MenuItem
            key={action}
            onClick={closeMenuAction(close, () => workflows.openAi(post, action))}
          >
            <AiIcon fontSize="small" sx={{ mr: 1 }} />
            {t(`facebookContent.aiActions.${action}`)}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={closeMenuAction(close, () => workflows.runQuickImport(post, false))}>
          <LibraryIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.addToLibrary')}
        </MenuItem>
        <MenuItem onClick={closeMenuAction(close, () => workflows.runQuickImport(post, true))}>
          <CopyIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.createPostCopy')}
        </MenuItem>
        <MenuItem onClick={closeMenuAction(close, () => workflows.openProduct(post))}>
          <ProductIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.convertToProduct')}
        </MenuItem>
        <MenuItem onClick={closeMenuAction(close, () => workflows.openCampaign(post))}>
          <CampaignIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.createCampaignFromPost')}
        </MenuItem>
        <MenuItem onClick={closeMenuAction(close, () => workflows.openSchedule(post))}>
          <ScheduleIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.scheduleAgain')}
        </MenuItem>
        <MenuItem onClick={closeMenuAction(close, () => workflows.openHistory(post))}>
          <HistoryIcon fontSize="small" sx={{ mr: 1 }} />
          {t('facebookContent.publicationHistory')}
        </MenuItem>
      </Menu>
    </>
  );
};

export const FacebookPostWorkflowDialogs = ({ t, workflows }) => (
  <>
    <FacebookPostProductDialog
      draft={workflows.product.draft}
      onChange={draft => workflows.setProduct(current => ({ ...current, draft }))}
      onClose={() => workflows.setProduct({
        open: false,
        post: null,
        draft: null,
        saving: false,
      })}
      onSaveDraft={() => workflows.saveProduct(false)}
      onApprove={() => workflows.saveProduct(true)}
      open={workflows.product.open}
      saving={workflows.product.saving}
      t={t}
    />

    <Dialog
      open={workflows.ai.open}
      onClose={() => workflows.setAi(current => ({ ...current, open: false }))}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { 'aria-label': t('facebookContent.aiPostDialog') } }}
    >
      <DialogTitle>{t('facebookContent.aiPostDialog')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            select
            label={t('facebookContent.aiTask')}
            value={workflows.ai.action}
            onChange={event => workflows.setAi(current => ({
              ...current,
              action: event.target.value,
              variants: event.target.value === 'variants' ? 3 : 1,
            }))}
          >
            {['rewrite', 'variants', 'improve_cta', 'hashtags', 'shorten', 'tone'].map(action => (
              <MenuItem key={action} value={action}>
                {t(`facebookContent.aiActions.${action}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            multiline
            minRows={2}
            label={t('facebookContent.aiTaskInstruction')}
            placeholder={workflows.ai.action === 'tone'
              ? t('facebookContent.toneInstructionPlaceholder')
              : t('facebookContent.aiInstructionPlaceholder')}
            value={workflows.ai.taskInstruction}
            onChange={event => workflows.setAi(current => ({
              ...current,
              taskInstruction: event.target.value,
            }))}
          />
          {workflows.ai.action === 'variants' && (
            <TextField
              type="number"
              label={t('facebookContent.variantsCount')}
              value={workflows.ai.variants}
              onChange={event => workflows.setAi(current => ({
                ...current,
                variants: event.target.value,
              }))}
              inputProps={{ min: 1, max: 5 }}
            />
          )}
          <Alert severity="info">{t('facebookContent.aiDraftSafetyNote')}</Alert>
          {workflows.ai.result?.variants?.map((variant, index) => (
            <Paper key={`${variant.title}-${index}`} variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={800} sx={wrapSx}>{variant.title}</Typography>
              <Typography variant="body2" sx={{ ...wrapSx, my: 1 }}>{variant.body}</Typography>
              {variant.cta && <Typography color="primary" sx={wrapSx}>{variant.cta}</Typography>}
              {variant.hashtags?.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={wrapSx}>
                  {variant.hashtags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}
                </Typography>
              )}
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => workflows.setAi(current => ({ ...current, open: false }))}>
          {t('common.close')}
        </Button>
        <Button
          variant="contained"
          onClick={workflows.runAi}
          disabled={workflows.ai.loading}
          startIcon={workflows.ai.loading ? <CircularProgress size={18} /> : <AiIcon />}
        >
          {t('facebookContent.runAiTool')}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog
      open={workflows.campaign.open}
      onClose={() => workflows.setCampaign(current => ({ ...current, open: false }))}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { 'aria-label': t('facebookContent.createCampaignFromPost') } }}
    >
      <DialogTitle>{t('facebookContent.createCampaignFromPost')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            required
            label={t('facebookContent.campaignName')}
            value={workflows.campaign.name}
            onChange={event => workflows.setCampaign(current => ({
              ...current,
              name: event.target.value,
            }))}
          />
          <TextField
            required
            label={t('facebookContent.campaignTimes')}
            helperText={t('facebookContent.campaignTimesHint')}
            value={workflows.campaign.scheduleTimes}
            onChange={event => workflows.setCampaign(current => ({
              ...current,
              scheduleTimes: event.target.value,
            }))}
          />
          <Alert severity="info">{t('facebookContent.campaignDraftNote')}</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => workflows.setCampaign(current => ({ ...current, open: false }))}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={workflows.createCampaign}
          disabled={workflows.campaign.loading || !workflows.campaign.name.trim()}
        >
          {workflows.campaign.loading
            ? <CircularProgress size={18} />
            : t('facebookContent.createCampaign')}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog
      open={workflows.schedule.open}
      onClose={() => workflows.setSchedule(current => ({ ...current, open: false }))}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { 'aria-label': t('facebookContent.scheduleAgain') } }}
    >
      <DialogTitle>{t('facebookContent.scheduleAgain')}</DialogTitle>
      <DialogContent dividers>
        <TextField
          fullWidth
          type="datetime-local"
          label={t('facebookContent.scheduleTime')}
          value={workflows.schedule.scheduledFor}
          onChange={event => workflows.setSchedule(current => ({
            ...current,
            scheduledFor: event.target.value,
          }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('facebookContent.scheduleApprovalNote')}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => workflows.setSchedule(current => ({ ...current, open: false }))}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={workflows.scheduleAgain}
          disabled={workflows.schedule.loading || !workflows.schedule.scheduledFor}
        >
          {workflows.schedule.loading
            ? <CircularProgress size={18} />
            : t('facebookContent.confirmScheduleAgain')}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog
      open={workflows.history.open}
      onClose={() => workflows.setHistory(current => ({ ...current, open: false }))}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { 'aria-label': t('facebookContent.publicationHistory') } }}
    >
      <DialogTitle>{t('facebookContent.publicationHistory')}</DialogTitle>
      <DialogContent dividers>
        {workflows.history.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : workflows.history.rows.length === 0 ? (
          <Alert severity="info">{t('facebookContent.noPublicationHistory')}</Alert>
        ) : (
          <Stack spacing={1}>
            {workflows.history.rows.map(row => (
              <Paper key={row.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  justifyContent="space-between"
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} sx={wrapSx}>
                      {row.content_title || row.product_name || t('facebookContent.post')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(row.scheduled_for).toLocaleString()}
                    </Typography>
                  </Box>
                  <Chip size="small" label={row.status} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => workflows.setHistory(current => ({ ...current, open: false }))}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  </>
);

export const FacebookPostPreview = ({
  imageUrl,
  link,
  message,
  pageName,
  product,
  t,
}) => (
  <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
    <Box sx={{ p: 2 }}>
      <Typography variant="overline" color="text.secondary">
        {t('facebookContent.preview')}
      </Typography>
      <Typography fontWeight={800}>{pageName || t('facebookContent.post')}</Typography>
      <Typography variant="body2" sx={{ ...wrapSx, mt: 1 }}>
        {message || t('facebookContent.previewEmpty')}
      </Typography>
      {product && (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={product.name}
          sx={{ mt: 1 }}
        />
      )}
    </Box>
    {imageUrl && (
      <CardMedia component="img" image={imageUrl} sx={{ maxHeight: 300, objectFit: 'cover' }} />
    )}
    {link && (
      <Typography variant="caption" color="primary" sx={{ display: 'block', p: 2, ...wrapSx }}>
        {link}
      </Typography>
    )}
  </Paper>
);

export const FacebookCommentTemplateDialog = ({ commentTools, t }) => (
  <Dialog
    open={commentTools.templateDialog}
    onClose={() => commentTools.setTemplateDialog(false)}
    maxWidth="sm"
    fullWidth
    slotProps={{ paper: { 'aria-label': t('facebookContent.replyTemplates') } }}
  >
    <DialogTitle>{t('facebookContent.replyTemplates')}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        {commentTools.templates.map(template => (
          <Card key={template.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={800} sx={wrapSx}>{template.name}</Typography>
                  <Typography variant="body2" sx={wrapSx}>{template.body}</Typography>
                </Box>
                <Box sx={{ flexShrink: 0 }}>
                  <IconButton
                    size="small"
                    aria-label={t('common.edit')}
                    onClick={() => commentTools.setTemplateForm({
                      id: template.id,
                      name: template.name,
                      body: template.body,
                    })}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={t('common.delete')}
                    onClick={() => commentTools.deleteTemplate(template)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {commentTools.templates.length === 0 && (
          <Alert severity="info">{t('facebookContent.noReplyTemplates')}</Alert>
        )}
        <Divider />
        <TextField
          label={t('facebookContent.replyTemplateName')}
          value={commentTools.templateForm.name}
          onChange={event => commentTools.setTemplateForm(current => ({
            ...current,
            name: event.target.value,
          }))}
        />
        <TextField
          multiline
          minRows={3}
          label={t('facebookContent.replyTemplateBody')}
          value={commentTools.templateForm.body}
          onChange={event => commentTools.setTemplateForm(current => ({
            ...current,
            body: event.target.value,
          }))}
        />
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={() => commentTools.setTemplateDialog(false)}>{t('common.close')}</Button>
      <Button
        variant="contained"
        onClick={commentTools.saveTemplate}
        disabled={
          commentTools.templateSaving
          || !commentTools.templateForm.name.trim()
          || !commentTools.templateForm.body.trim()
        }
      >
        {commentTools.templateSaving
          ? <CircularProgress size={18} />
          : t('common.save')}
      </Button>
    </DialogActions>
  </Dialog>
);

export const FacebookCommentTemplateSelect = ({
  commentId,
  commentTools,
  t,
}) => (
  <TextField
    select
    size="small"
    label={t('facebookContent.replyTemplate')}
    value=""
    onChange={event => commentTools.applyTemplate(commentId, event.target.value)}
    sx={{ minWidth: { xs: '100%', sm: 150 } }}
  >
    {commentTools.templates.map(template => (
      <MenuItem key={template.id} value={template.body}>{template.name}</MenuItem>
    ))}
  </TextField>
);
