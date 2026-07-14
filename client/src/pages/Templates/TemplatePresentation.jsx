import { Chip } from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Schedule as ScheduleIcon
} from '@mui/icons-material';
import { tx } from '../../i18n/tx';

const STATUS_CONFIG = {
  draft: ['auto.k_b41c2947f345', 'default', EditIcon],
  pending: ['auto.k_16c3c3d39b36', 'warning', ScheduleIcon],
  approved: ['auto.k_b9e290a250b9', 'success', CheckIcon],
  rejected: ['auto.k_7eb70f32aae1', 'error', CloseIcon],
  paused: ['auto.k_bafc44588818', 'warning', ScheduleIcon],
  disabled: ['auto.k_01813f1fbf17', 'default', CloseIcon],
  in_appeal: ['auto.k_59b533cf030f', 'warning', ScheduleIcon],
  pending_deletion: ['auto.k_096531e90ff3', 'error', CloseIcon],
  deleted: ['auto.k_376db6c9a6c0', 'error', CloseIcon],
  limit_exceeded: ['auto.k_da3274c137fd', 'error', CloseIcon]
};

export const TemplateStatusChip = ({ status }) => {
  const normalized = String(status || 'draft').toLowerCase();
  const [labelKey, color, Icon] = STATUS_CONFIG[normalized] || STATUS_CONFIG.draft;
  return <Chip label={tx(labelKey)} color={color} size="small" icon={<Icon fontSize="small" />} />;
};

export const TemplateQualityChip = ({ qualityScore }) => {
  const quality = String(qualityScore || '').toUpperCase();
  const config = {
    HIGH: ['auto.k_a97cf40cd303', 'success'],
    MEDIUM: ['auto.k_d74cc1532b1c', 'warning'],
    LOW: ['auto.k_d3357c20b7d8', 'error']
  }[quality];
  if (!config) return null;
  return <Chip label={tx(config[0])} color={config[1]} size="small" variant="outlined" sx={{ ml: 0.5 }} />;
};
