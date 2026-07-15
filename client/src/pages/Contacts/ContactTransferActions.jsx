import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  Download as DownloadIcon,
  UploadFile as UploadFileIcon,
} from '@mui/icons-material';
import { tx } from '../../i18n/tx';

const saveDownload = ({ blob, filename }) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const ContactTransferActions = ({
  accentColor = 'primary',
  importDisabled = false,
  importDisabledReason,
  onExport,
  onImport,
  onImported,
}) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const handleImport = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('import');
    try {
      const result = await onImport(file);
      setFeedback({
        severity: result.failed > 0 ? 'warning' : 'success',
        message: tx('contacts.importResult', {
          created: result.created,
          updated: result.updated,
          failed: result.failed,
        }),
      });
      await onImported?.(result);
    } catch (error) {
      setFeedback({ severity: 'error', message: error.message || tx('contacts.transferFailed') });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    setBusy('export');
    try {
      saveDownload(await onExport());
      setFeedback({ severity: 'success', message: tx('contacts.exportReady') });
    } catch (error) {
      setFeedback({ severity: 'error', message: error.message || tx('contacts.transferFailed') });
    } finally {
      setBusy(null);
    }
  };

  return <>
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <Tooltip title={importDisabled ? importDisabledReason : tx('contacts.csvFormat')}>
        <Box component="span">
          <Button
            component="label"
            role={undefined}
            color={accentColor}
            variant="outlined"
            disabled={importDisabled || !!busy}
            startIcon={busy === 'import' ? <CircularProgress size={18} /> : <UploadFileIcon />}
          >
            {tx('contacts.importCsv')}
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={handleImport}
            />
          </Button>
        </Box>
      </Tooltip>
      <Button
        color={accentColor}
        variant="outlined"
        disabled={!!busy}
        onClick={handleExport}
        startIcon={busy === 'export' ? <CircularProgress size={18} /> : <DownloadIcon />}
      >
        {tx('contacts.exportCsv')}
      </Button>
    </Box>
    <Snackbar
      open={!!feedback}
      autoHideDuration={7000}
      onClose={() => setFeedback(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={feedback?.severity || 'info'} onClose={() => setFeedback(null)}>
        {feedback?.message}
      </Alert>
    </Snackbar>
  </>;
};

export default ContactTransferActions;
