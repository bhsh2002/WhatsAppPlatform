import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Chat as ChatIcon,
  Delete as DeleteIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { tx } from '../../i18n/tx';
import { getCurrentLocale } from '../../utils/locale';
import { getContactLabelOptions } from './contactConfig';

export const ContactLabelChip = ({ label }) => {
  if (!label) return <Chip label="—" size="small" variant="outlined" />;
  const option = getContactLabelOptions().find((item) => item.value === label);
  return <Chip label={label} size="small" color={option?.color || 'default'} />;
};

export const ContactCtwaChip = ({ contact }) => {
  if (!contact.last_ctwa_clid) {
    return <Chip label={tx('auto.k_87e8e1d53a84')} size="small" variant="outlined" />;
  }
  const receivedAt = contact.last_ctwa_received_at
    ? new Date(contact.last_ctwa_received_at).toLocaleString(getCurrentLocale())
    : tx('auto.k_b2c702e73c91');
  return (
    <Tooltip title={tx('auto.k_e785b4075213', { value1: receivedAt })}>
      <Chip label={tx('auto.k_5ad7cf172cdb')} size="small" color="success" variant="outlined" />
    </Tooltip>
  );
};

export const ContactIdentitySummary = ({ contact }) => (
  <>
    <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
      <Typography variant="caption" color="text.secondary">{tx('auto.k_211cce4ca4ef')}</Typography>
      <Typography variant="h6" fontFamily="monospace">{contact.phone}</Typography>
    </Box>
    <Box sx={{
      p: 2,
      bgcolor: contact.last_ctwa_clid ? 'rgba(46, 125, 50, 0.08)' : 'grey.50',
      borderRadius: 2
    }}>
      <Typography variant="caption" color="text.secondary">Click-to-WhatsApp</Typography>
      <Typography variant="body2" fontWeight={700}>
        {contact.last_ctwa_clid ? tx('auto.k_7703b47ee7b2') : tx('auto.k_d8af21485f4f')}
      </Typography>
      {contact.last_ctwa_clid && <>
        <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}>
          {contact.last_ctwa_clid}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {contact.last_ctwa_source_type || 'source'}{contact.last_ctwa_source_url ? ` • ${contact.last_ctwa_source_url}` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {tx('auto.k_7ccbdd62be55')}
          {contact.last_ctwa_received_at
            ? new Date(contact.last_ctwa_received_at).toLocaleString(getCurrentLocale())
            : tx('auto.k_b2c702e73c91')}
        </Typography>
      </>}
    </Box>
  </>
);

export const ContactTable = ({
  accentColor = 'primary',
  contacts,
  emptyMessageKey,
  loading,
  onDelete,
  onEdit,
  onOpenConversation,
  onPageChange,
  onRowsPerPageChange,
  page,
  rowsPerPage,
  showTenant = false,
  total
}) => {
  const columnCount = showTenant ? 8 : 7;
  return (
    <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
      <Table sx={{ minWidth: showTenant ? 1120 : 940, tableLayout: 'auto' }}>
        <TableHead>
          <TableRow>
            <TableCell>{tx('auto.k_211cce4ca4ef')}</TableCell>
            <TableCell>{tx('auto.k_0a92494ea1eb')}</TableCell>
            {showTenant && <TableCell>{tx('auto.k_8adba91e1d87')}</TableCell>}
            <TableCell>{tx('auto.k_7c75fec5c0f8')}</TableCell>
            <TableCell>CTWA</TableCell>
            <TableCell>{tx('auto.k_434e1cb2e6b0')}</TableCell>
            <TableCell>{tx('auto.k_2723fb0ddcdf')}</TableCell>
            <TableCell align="right">{tx('auto.k_8edfb81a349f')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? <TableRow>
            <TableCell colSpan={columnCount} align="center" sx={{ py: 4 }}><CircularProgress /></TableCell>
          </TableRow> : contacts.length === 0 ? <TableRow>
            <TableCell colSpan={columnCount} align="center" sx={{ py: 4 }}>
              <Typography color="text.secondary">{tx(emptyMessageKey)}</Typography>
            </TableCell>
          </TableRow> : contacts.map((contact) => <TableRow key={contact.id || contact.phone} hover>
            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 150 }}>{contact.phone}</TableCell>
            <TableCell sx={{ minWidth: 150 }}>{contact.profile_name || '—'}</TableCell>
            {showTenant && <TableCell sx={{ minWidth: 150 }}>
              {contact.tenant_name ? <Chip label={contact.tenant_name} size="small" variant="outlined" /> : '—'}
            </TableCell>}
            <TableCell><ContactLabelChip label={contact.label} /></TableCell>
            <TableCell><ContactCtwaChip contact={contact} /></TableCell>
            <TableCell><Chip label={contact.message_count || 0} size="small" variant="outlined" color={accentColor} /></TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {contact.updated_at ? new Date(contact.updated_at).toLocaleDateString(getCurrentLocale()) : '—'}
            </TableCell>
            <TableCell align="right">
              <Tooltip title={tx('auto.k_b4f76c3aa21e')}>
                <IconButton aria-label={tx('auto.k_b4f76c3aa21e')} size="small" onClick={() => onEdit(contact)}><EditIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={tx('auto.k_3e5e6412e5dd')}>
                <IconButton aria-label={tx('auto.k_3e5e6412e5dd')} size="small" color={accentColor} onClick={() => onOpenConversation(contact)}>
                  <ChatIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={tx('auto.k_2d2bbdc2d694')}>
                <IconButton aria-label={tx('auto.k_2d2bbdc2d694')} size="small" color="error" onClick={() => onDelete(contact)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={onPageChange}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={onRowsPerPageChange}
        labelRowsPerPage={tx('auto.k_cbae7baf21a2')}
        labelDisplayedRows={({ from, to, count }) => tx('auto.k_dd273d63f7ed', {
          value1: from,
          value2: to,
          value3: count
        })}
      />
    </TableContainer>
  );
};

export const ContactDeleteDialog = ({ contact, deleting, onCancel, onConfirm }) => (
  <Dialog open={!!contact} onClose={() => !deleting && onCancel()} slotProps={{ paper: { 'aria-label': tx('auto.k_107bd07072b8') } }}>
    <DialogTitle>{tx('auto.k_107bd07072b8')}</DialogTitle>
    <DialogContent>
      <Typography>
        {tx('auto.k_a37f4e636a64')}<strong>{contact?.profile_name || contact?.phone}</strong>{tx('auto.k_d14862b0be83')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tx('auto.k_b34b205af566')}</Typography>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={deleting}>{tx('auto.k_e776b0209b50')}</Button>
      <Button
        variant="contained"
        color="error"
        onClick={onConfirm}
        disabled={deleting}
        startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
      >
        {deleting ? tx('auto.k_8e2d11bd1ef2') : tx('auto.k_2d2bbdc2d694')}
      </Button>
    </DialogActions>
  </Dialog>
);
