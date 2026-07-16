import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import {
  Image as ImageIcon,
  Link as LinkIcon,
  Schedule as ScheduleIcon,
  TextSnippet as TextIcon
} from '@mui/icons-material';
import { FACEBOOK_POST_TRUNCATE_LENGTH } from './facebookContentConfig';

const POST_TABS = [
  { value: 'text', icon: <TextIcon /> },
  { value: 'photo', icon: <ImageIcon /> },
  { value: 'link', icon: <LinkIcon /> },
  { value: 'schedule', icon: <ScheduleIcon /> }
];

export const FacebookPostComposerTabs = ({ onChange, t, value }) => (
  <Tabs value={value} onChange={(_, nextValue) => onChange(nextValue)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
    {POST_TABS.map(({ value: tabValue, icon }) => (
      <Tab
        key={tabValue}
        value={tabValue}
        label={t(`facebookContent.tabs.${tabValue}`)}
        icon={icon}
        iconPosition="start"
        sx={{ minHeight: 48 }}
      />
    ))}
  </Tabs>
);

export const FacebookPostMessage = ({ expanded, hasPicture, message, onToggle, t }) => {
  const content = message || t('facebookContent.untitledPost');
  const isLong = content.length > FACEBOOK_POST_TRUNCATE_LENGTH;
  return (
    <Box>
      <Typography sx={{ whiteSpace: 'pre-wrap', mb: hasPicture ? 1 : 0 }}>
        {isLong && !expanded
          ? `${content.substring(0, FACEBOOK_POST_TRUNCATE_LENGTH)}...`
          : content}
      </Typography>
      {isLong && <Button size="small" onClick={onToggle}>
        {expanded ? t('facebookContent.showLess') : t('facebookContent.showMore')}
      </Button>}
    </Box>
  );
};

export const FacebookDeleteDialog = ({
  deleteType,
  deleting,
  onCancel,
  onDeleteComment,
  onDeletePost,
  open,
  t
}) => (
  <Dialog open={open} onClose={onCancel} slotProps={{ paper: { 'aria-label': deleteType === 'post' ? t('facebookContent.deletePost') : t('facebookContent.deleteComment') } }}>
    <DialogTitle>
      {deleteType === 'post' ? t('facebookContent.deletePost') : t('facebookContent.deleteComment')}
    </DialogTitle>
    <DialogContent>
      <Typography>
        {t('facebookContent.deleteConfirm', {
          target: deleteType === 'post' ? t('facebookContent.thisPost') : t('facebookContent.thisComment')
        })}
      </Typography>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button
        variant="contained"
        color="error"
        onClick={deleteType === 'post' ? onDeletePost : onDeleteComment}
        disabled={deleting}
      >
        {deleting ? <CircularProgress size={18} /> : t('facebookContent.delete')}
      </Button>
    </DialogActions>
  </Dialog>
);

export const FacebookPostProductDialog = ({
  draft,
  onChange,
  onClose,
  onApprove,
  onSaveDraft,
  open,
  saving,
  t
}) => {
  const update = (field, value) => onChange({ ...draft, [field]: value });
  const approvalReady = Boolean(
    draft?.name?.trim()
    && draft?.sku?.trim()
    && draft?.category?.trim()
    && Number(draft?.price) > 0
  );

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { 'aria-label': t('facebookContent.convertToProduct') } }}
    >
      <DialogTitle>{t('facebookContent.convertToProduct')}</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('facebookContent.convertToProductHint')}
        </Alert>
        {!approvalReady && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('facebookContent.productApprovalHint')}
          </Alert>
        )}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2
        }}>
          <TextField
            required
            label={t('facebookContent.productFields.name')}
            value={draft?.name || ''}
            onChange={event => update('name', event.target.value)}
            inputProps={{ maxLength: 160 }}
          />
          <TextField
            label={t('facebookContent.productFields.sku')}
            value={draft?.sku || ''}
            onChange={event => update('sku', event.target.value)}
          />
          <TextField
            type="number"
            label={t('facebookContent.productFields.price')}
            value={draft?.price ?? ''}
            onChange={event => update('price', event.target.value)}
            inputProps={{ min: 0, step: '0.01' }}
          />
          <TextField
            label={t('facebookContent.productFields.currency')}
            value={draft?.currency || 'LYD'}
            onChange={event => update('currency', event.target.value.toUpperCase())}
            inputProps={{ maxLength: 8 }}
          />
          <TextField
            label={t('facebookContent.productFields.category')}
            value={draft?.category || ''}
            onChange={event => update('category', event.target.value)}
          />
          <TextField
            select
            label={t('facebookContent.productFields.availability')}
            value={draft?.availability || 'available'}
            onChange={event => update('availability', event.target.value)}
          >
            {['available', 'out_of_stock', 'hidden'].map(value => (
              <MenuItem key={value} value={value}>
                {t(`facebookContent.productAvailability.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('facebookContent.productFields.productUrl')}
            value={draft?.product_url || ''}
            onChange={event => update('product_url', event.target.value)}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
          <TextField
            label={t('facebookContent.productFields.imageUrl')}
            value={draft?.image_url || ''}
            onChange={event => update('image_url', event.target.value)}
            helperText={t('facebookContent.productImageHint')}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
          <TextField
            multiline
            minRows={5}
            label={t('facebookContent.productFields.description')}
            value={draft?.description || ''}
            onChange={event => update('description', event.target.value)}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button
          variant="outlined"
          onClick={onSaveDraft}
          disabled={saving || !draft?.name?.trim()}
        >
          {t('facebookContent.saveProductDraft')}
        </Button>
        <Button
          variant="contained"
          onClick={onApprove}
          disabled={saving || !approvalReady}
        >
          {saving ? <CircularProgress size={18} /> : t('facebookContent.approveProduct')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const FacebookContentSnackbar = ({ onClose, snackbar }) => (
  <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={onClose}>
    <Alert severity={snackbar.severity} onClose={onClose}>{snackbar.message}</Alert>
  </Snackbar>
);
