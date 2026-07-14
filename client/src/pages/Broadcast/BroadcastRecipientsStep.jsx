import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import {
  People as PeopleIcon,
  Search as SearchIcon,
  SelectAll as SelectAllIcon,
  Send as SendIcon,
  TextFields as StaticIcon
} from '@mui/icons-material';
import { tx } from '../../i18n/tx';

export const BroadcastRecipientsStep = ({
  accentColor = 'primary',
  allFilteredSelected,
  availableCredits = null,
  canProceed,
  contactSearch,
  contacts,
  contactsLoading,
  emptyMessageKey,
  filteredContacts,
  labelFilter,
  manualHelpKey,
  manualRecipients,
  maxRecipients,
  onBack,
  onContactSearchChange,
  onDeselectAll,
  onLabelFilterChange,
  onNext,
  onRecipientsTabChange,
  onRecipientsTextChange,
  onSelectAll,
  onSelectByLabel,
  onToggleContact,
  overLimitMessageKey,
  recipientsTab,
  recipientsText,
  selectedContactIds,
  uniqueLabels,
  uniqueRecipients
}) => (
  <Paper sx={{ p: 3 }}>
    <Typography variant="h6" fontWeight={600} gutterBottom>{tx('auto.k_5cadd95cd0c6')}</Typography>
    <Tabs value={recipientsTab} onChange={(_, value) => onRecipientsTabChange(value)} sx={{ mb: 2 }}>
      <Tab
        icon={<PeopleIcon />}
        iconPosition="start"
        label={tx('auto.k_e0f85c990efc', { value1: contacts.length })}
      />
      <Tab icon={<StaticIcon />} iconPosition="start" label={tx('auto.k_3fcbc349597c')} />
    </Tabs>

    {recipientsTab === 0 && <Box>
      {contactsLoading ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box> : contacts.length === 0 ? <Alert severity="info" sx={{ mb: 2 }}>
        {tx(emptyMessageKey)}
      </Alert> : <>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={tx('auto.k_6781448a8fb6')}
            value={contactSearch}
            onChange={(event) => onContactSearchChange(event.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{tx('auto.k_d580c3a35b18')}</InputLabel>
            <Select
              value={labelFilter}
              label={tx('auto.k_d580c3a35b18')}
              onChange={(event) => onLabelFilterChange(event.target.value)}
            >
              <MenuItem value="">{tx('auto.k_11fdef2dc5f8')}</MenuItem>
              {uniqueLabels.map((label) => <MenuItem key={label} value={label}>{label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" variant="outlined" startIcon={<SelectAllIcon />} onClick={onSelectAll}>
            {tx('auto.k_b04117b1dfee')}{filteredContacts.length})
          </Button>
          <Button size="small" variant="outlined" color="inherit" onClick={onDeselectAll}>
            {tx('auto.k_41640caf219b')}
          </Button>
          {uniqueLabels.length > 0 && <>
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
              {tx('auto.k_2f7d3481d42f')}
            </Typography>
            {uniqueLabels.map((label) => <Chip
              key={label}
              label={label}
              size="small"
              variant="outlined"
              onClick={() => onSelectByLabel(label)}
              sx={{ cursor: 'pointer' }}
            />)}
          </>}
        </Box>

        <TableContainer sx={{ maxHeight: 400, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={!allFilteredSelected && filteredContacts.some((contact) => selectedContactIds.has(contact.id))}
                    onChange={() => allFilteredSelected ? onDeselectAll() : onSelectAll()}
                  />
                </TableCell>
                <TableCell>{tx('auto.k_0a92494ea1eb')}</TableCell>
                <TableCell>{tx('auto.k_3a4ffd0856f9')}</TableCell>
                <TableCell>{tx('auto.k_7c75fec5c0f8')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContacts.map((contact) => <TableRow
                key={contact.id}
                hover
                onClick={() => onToggleContact(contact.id)}
                sx={{ cursor: 'pointer' }}
                selected={selectedContactIds.has(contact.id)}
              >
                <TableCell padding="checkbox"><Checkbox checked={selectedContactIds.has(contact.id)} /></TableCell>
                <TableCell>{contact.profile_name || '—'}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', direction: 'ltr' }}>{contact.phone}</TableCell>
                <TableCell>{contact.label && <Chip label={contact.label} size="small" variant="outlined" />}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </TableContainer>
      </>}
    </Box>}

    {recipientsTab === 1 && <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tx(manualHelpKey)}</Typography>
      <TextField
        fullWidth
        multiline
        rows={8}
        placeholder={'218911234567\n218921234567\n+218931234567'}
        value={recipientsText}
        onChange={(event) => onRecipientsTextChange(event.target.value)}
        sx={{ fontFamily: 'monospace' }}
      />
    </Box>}

    <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {selectedContactIds.size > 0 && <Chip
        icon={<PeopleIcon />}
        label={tx('auto.k_a56483eb6608', { value1: selectedContactIds.size })}
        color={accentColor}
        size="small"
      />}
      {manualRecipients.length > 0 && <Chip
        icon={<StaticIcon />}
        label={tx('auto.k_4a828e378d8b', { value1: manualRecipients.length })}
        color="default"
        size="small"
      />}
      <Chip
        icon={<SendIcon />}
        label={tx('auto.k_6ea51819a496', { value1: uniqueRecipients.length })}
        color={uniqueRecipients.length > maxRecipients ? 'error' : uniqueRecipients.length > 0 ? 'success' : 'default'}
      />
      {uniqueRecipients.length > maxRecipients && <Alert severity="error" sx={{ flex: 1 }}>
        {tx(overLimitMessageKey)}
      </Alert>}
      {availableCredits !== null && availableCredits < uniqueRecipients.length && <Alert severity="warning" sx={{ flex: 1 }}>
        {tx('auto.k_84269774a62c')}{availableCredits}{tx('auto.k_f317159163b6')}
      </Alert>}
    </Box>

    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
      <Button onClick={onBack}>{tx('auto.k_f533ebab64f4')}</Button>
      <Button variant="contained" color={accentColor} disabled={!canProceed} onClick={onNext}>
        {tx('auto.k_2fa619787bcb')}
      </Button>
    </Box>
  </Paper>
);
