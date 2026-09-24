import React, { useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormHelperText,
    InputLabel,
    MenuItem,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import {
    ChatBubbleOutline as ContinueIcon,
    Sms as SmsIcon,
    WhatsApp as WhatsAppIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';

import Select from '../Form/AccessibleSelect';
import { useLanguage } from '../../context/LanguageContext';
import {
    availableSmsAccounts,
    buildNewMessageDraft,
    resolveSmsAccountId,
} from './newMessageDraft';

const NewMessageDialog = ({
    open,
    onClose,
    onContinue,
    smsAccounts = [],
    smsAccountsLoading = false,
    smsAccountsError = '',
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { t } = useLanguage();
    const activeSmsAccounts = useMemo(
        () => availableSmsAccounts(smsAccounts),
        [smsAccounts],
    );
    const [channel, setChannel] = useState('whatsapp');
    const [recipient, setRecipient] = useState('');
    const [message, setMessage] = useState('');
    const [smsAccountId, setSmsAccountId] = useState('');
    const [errors, setErrors] = useState({});
    const smsAccountErrorId = 'new-message-sms-account-error';
    const resolvedSmsAccountId = useMemo(
        () => resolveSmsAccountId(activeSmsAccounts, smsAccountId),
        [activeSmsAccounts, smsAccountId],
    );

    const handleChannelChange = (_event, value) => {
        if (!value) return;
        setChannel(value);
        setErrors(previous => ({ ...previous, channel: undefined, smsAccountId: undefined }));
    };

    const handleSubmit = event => {
        event.preventDefault();
        const draft = buildNewMessageDraft({
            channel,
            recipient,
            message,
            smsAccountId: resolvedSmsAccountId,
        }, smsAccounts);
        if (!draft.valid) {
            setErrors(draft.errors);
            return;
        }
        onContinue(draft);
    };

    const smsUnavailable = channel === 'sms'
        && !smsAccountsLoading
        && activeSmsAccounts.length === 0;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            fullScreen={isMobile}
            maxWidth="sm"
            aria-labelledby="new-message-dialog-title"
            aria-describedby="new-message-dialog-description"
            slotProps={{
                paper: {
                    component: 'form',
                    onSubmit: handleSubmit,
                    sx: {
                        width: { sm: 'min(calc(100% - 48px), 560px)' },
                        m: { xs: 0, sm: 3 },
                        borderRadius: { xs: 0, sm: 3 },
                    },
                },
            }}
        >
            <DialogTitle id="new-message-dialog-title" sx={{ pb: 1 }}>
                {t('inbox.newMessage')}
            </DialogTitle>
            <DialogContent dividers sx={{ py: 2.5 }}>
                <Stack spacing={2.5}>
                    <Typography id="new-message-dialog-description" variant="body2" color="text.secondary">
                        {t('inbox.newMessageHelp')}
                    </Typography>

                    <Box>
                        <Typography component="div" variant="subtitle2" fontWeight={700} mb={1}>
                            {t('inbox.channel')}
                        </Typography>
                        <ToggleButtonGroup
                            exclusive
                            fullWidth
                            value={channel}
                            onChange={handleChannelChange}
                            aria-label={t('inbox.channel')}
                            color="primary"
                            sx={{
                                '& .MuiToggleButton-root': {
                                    gap: 1,
                                    py: 1.25,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                },
                            }}
                        >
                            <ToggleButton value="whatsapp" aria-label="WhatsApp">
                                <WhatsAppIcon sx={{ color: '#25D366' }} />
                                WhatsApp
                            </ToggleButton>
                            <ToggleButton value="sms" aria-label="SMS">
                                <SmsIcon sx={{ color: '#7c3aed' }} />
                                SMS
                            </ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    {channel === 'sms' && (
                        <>
                            {smsAccountsError ? (
                                <Alert severity="error">{smsAccountsError}</Alert>
                            ) : smsAccountsLoading ? (
                                <Stack direction="row" alignItems="center" gap={1.5} py={1}>
                                    <CircularProgress size={22} />
                                    <Typography variant="body2" color="text.secondary">
                                        {t('inbox.loadingSmsAccounts')}
                                    </Typography>
                                </Stack>
                            ) : smsUnavailable ? (
                                <Alert
                                    severity="info"
                                    action={(
                                        <Button
                                            component={RouterLink}
                                            to="/portal/integrations/sms"
                                            color="inherit"
                                            size="small"
                                            onClick={onClose}
                                        >
                                            {t('inbox.openSmsAccounts')}
                                        </Button>
                                    )}
                                >
                                    {t('inbox.noSmsAccount')}
                                </Alert>
                            ) : (
                                <FormControl fullWidth error={Boolean(errors.smsAccountId)}>
                                    <InputLabel id="new-message-sms-account-label">
                                        {t('inbox.smsAccount')}
                                    </InputLabel>
                                    <Select
                                        labelId="new-message-sms-account-label"
                                        value={resolvedSmsAccountId}
                                        label={t('inbox.smsAccount')}
                                        inputProps={{
                                            'aria-describedby': errors.smsAccountId
                                                ? smsAccountErrorId
                                                : undefined,
                                            'aria-invalid': Boolean(errors.smsAccountId),
                                        }}
                                        onChange={event => {
                                            setSmsAccountId(event.target.value);
                                            setErrors(previous => ({ ...previous, smsAccountId: undefined }));
                                        }}
                                    >
                                        <MenuItem value="" disabled>
                                            {t('inbox.chooseSmsAccount')}
                                        </MenuItem>
                                        {activeSmsAccounts.map(account => (
                                            <MenuItem key={account.id} value={String(account.id)}>
                                                {account.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                    {errors.smsAccountId && (
                                        <FormHelperText id={smsAccountErrorId}>
                                            {t('inbox.chooseSmsAccount')}
                                        </FormHelperText>
                                    )}
                                </FormControl>
                            )}
                        </>
                    )}

                    <TextField
                        autoFocus
                        fullWidth
                        required
                        label={t('inbox.recipientNumber')}
                        value={recipient}
                        onChange={event => {
                            setRecipient(event.target.value);
                            setErrors(previous => ({ ...previous, recipient: undefined }));
                        }}
                        error={Boolean(errors.recipient)}
                        helperText={errors.recipient
                            ? t('inbox.invalidRecipient')
                            : t('inbox.recipientHelp')}
                        inputProps={{
                            inputMode: 'tel',
                            autoComplete: 'tel',
                            dir: 'ltr',
                            maxLength: 32,
                        }}
                    />

                    <TextField
                        fullWidth
                        multiline
                        minRows={3}
                        maxRows={7}
                        label={t('inbox.initialMessage')}
                        value={message}
                        onChange={event => setMessage(event.target.value.slice(0, 4096))}
                        helperText={t('inbox.initialMessageHelp')}
                    />

                    {channel === 'whatsapp' && (
                        <Alert severity="info" icon={false}>
                            {t('inbox.whatsappTemplateHint')}
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
                <Button onClick={onClose} color="inherit">
                    {t('common.cancel')}
                </Button>
                <Button
                    type="submit"
                    variant="contained"
                    endIcon={<ContinueIcon />}
                    disabled={channel === 'sms' && (
                        smsAccountsLoading || Boolean(smsAccountsError) || smsUnavailable
                    )}
                >
                    {t('inbox.openConversation')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default NewMessageDialog;
