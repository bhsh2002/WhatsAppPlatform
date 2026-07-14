import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Tab,
  Tabs,
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

export const FacebookContentSnackbar = ({ onClose, snackbar }) => (
  <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={onClose}>
    <Alert severity={snackbar.severity} onClose={onClose}>{snackbar.message}</Alert>
  </Snackbar>
);
