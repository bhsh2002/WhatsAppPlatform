import { Chip } from '@mui/material';
import {
  ChatBubble as CommentReplyIcon,
  Facebook as FacebookIcon,
  NightsStay as AwayIcon,
  SmartToy as SmartToyIcon,
  VpnKey as KeywordIcon,
  WavingHand as WelcomeIcon,
  WhatsApp as WhatsAppIcon
} from '@mui/icons-material';
import { tx } from '../../i18n/tx';

export const AutomationRuleTypeIcon = ({ type }) => {
  const icons = {
    keyword: KeywordIcon,
    welcome: WelcomeIcon,
    away: AwayIcon,
    comment_reply: CommentReplyIcon
  };
  const Icon = icons[type] || SmartToyIcon;
  return <Icon sx={{ fontSize: 18 }} />;
};

export const AutomationChannelChip = ({ channel }) => {
  if (channel === 'whatsapp') {
    return <Chip icon={<WhatsAppIcon />} label={tx('auto.k_7b5629bcb45d')} size="small" sx={{ bgcolor: '#25D36622', color: '#25D366' }} />;
  }
  if (channel === 'messenger') {
    return <Chip icon={<FacebookIcon />} label={tx('auto.k_3cab5678293b')} size="small" sx={{ bgcolor: '#0084ff22', color: '#0084ff' }} />;
  }
  if (channel === 'facebook') {
    return <Chip icon={<FacebookIcon />} label={tx('auto.k_ac86ec8e2a63')} size="small" sx={{ bgcolor: '#1877f222', color: '#1877f2' }} />;
  }
  return <Chip label={tx('auto.k_11fdef2dc5f8')} size="small" variant="outlined" />;
};
