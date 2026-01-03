import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    Tabs,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    FormControl,
    Select,
    MenuItem,
    CircularProgress,
    IconButton,
    InputLabel
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    Warning as WarningIcon,
    CallReceived as IncomingIcon,
    CallMade as OutgoingIcon,
    Code as CodeIcon,
    Message as MessageIcon
} from '@mui/icons-material';
import api from '../../api';

const Logs = () => {
    const [activeTab, setActiveTab] = useState(0);
    const [messages, setMessages] = useState([]);
    const [webhookLogs, setWebhookLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState({ direction: '', status: '' });

    const fetchMessages = async () => {
        try {
            setLoading(true);
            const params = {};
            if (filter.direction) params.direction = filter.direction;
            const data = await api.getMessageLogs(params);
            setMessages(data.messages || []);
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchWebhookLogs = async () => {
        try {
            setLoading(true);
            const data = await api.getWebhookLogs(50);
            setWebhookLogs(data);
        } catch (error) {
            console.error('Failed to fetch webhook logs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 0) {
            fetchMessages();
        } else {
            fetchWebhookLogs();
        }
    }, [activeTab, filter]);

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'sent':
            case 'delivered':
            case 'read':
                return <CheckCircleIcon fontSize="small" color="success" />;
            case 'failed':
                return <ErrorIcon fontSize="small" color="error" />;
            default:
                return <WarningIcon fontSize="small" color="warning" />;
        }
    };

    const getDirectionIcon = (direction) => {
        if (direction === 'incoming') {
            return <IncomingIcon fontSize="small" color="primary" />;
        }
        return <OutgoingIcon fontSize="small" color="success" />;
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleString('ar-SA', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box>
                    <Typography variant="h4" fontWeight={700} gutterBottom>
                        سجلات التشغيل
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        عرض جميع الرسائل وأحداث الـ Webhook.
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    startIcon={loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={() => activeTab === 0 ? fetchMessages() : fetchWebhookLogs()}
                    disabled={loading}
                >
                    تحديث
                </Button>
            </Box>

            <Paper sx={{ mb: 3 }}>
                <Tabs value={activeTab} onChange={handleTabChange} variant="fullWidth">
                    <Tab icon={<MessageIcon />} label="الرسائل" iconPosition="start" />
                    <Tab icon={<CodeIcon />} label="Webhook Events" iconPosition="start" />
                </Tabs>
            </Paper>

            {/* Filters (for messages) */}
            {activeTab === 0 && (
                <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>الاتجاه</InputLabel>
                        <Select
                            value={filter.direction}
                            label="الاتجاه"
                            onChange={(e) => setFilter({ ...filter, direction: e.target.value })}
                        >
                            <MenuItem value="">كل الاتجاهات</MenuItem>
                            <MenuItem value="incoming">واردة</MenuItem>
                            <MenuItem value="outgoing">صادرة</MenuItem>
                        </Select>
                    </FormControl>
                </Paper>
            )}

            {/* Content */}
            <Paper sx={{ width: '100%', overflow: 'hidden' }}>
                {loading ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : activeTab === 0 ? (
                    messages.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            لا توجد رسائل
                        </Box>
                    ) : (
                        <TableContainer sx={{ maxHeight: 600 }}>
                            <Table stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>الاتجاه</TableCell>
                                        <TableCell>الرقم</TableCell>
                                        <TableCell>النوع</TableCell>
                                        <TableCell>المحتوى</TableCell>
                                        <TableCell>الحالة</TableCell>
                                        <TableCell>الوقت</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {messages.map((msg) => (
                                        <TableRow key={msg.id} hover>
                                            <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    {getDirectionIcon(msg.direction)}
                                                    {msg.direction === 'incoming' ? 'واردة' : 'صادرة'}
                                                </Box>
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>
                                                {msg.direction === 'incoming' ? msg.sender : msg.recipient}
                                            </TableCell>
                                            <TableCell>
                                                <Chip label={msg.message_type} size="small" variant="outlined" />
                                            </TableCell>
                                            <TableCell sx={{ maxWidth: 300 }}>
                                                <Typography noWrap variant="body2">{msg.content}</Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    {getStatusIcon(msg.status)}
                                                    {msg.status}
                                                </Box>
                                            </TableCell>
                                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                                                {formatDate(msg.created_at)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )
                ) : (
                    webhookLogs.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                            لا توجد أحداث Webhook
                        </Box>
                    ) : (
                        <Box sx={{ maxHeight: 600, overflow: 'auto', p: 0 }}>
                            {webhookLogs.map((log, index) => (
                                <Box
                                    key={log.id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < webhookLogs.length - 1 ? '1px solid divider' : 'none',
                                        bgcolor: 'background.paper',
                                        '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                >
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                        <Chip
                                            label={log.event_type}
                                            size="small"
                                            color="primary"
                                            variant="outlined"
                                        />
                                        <Typography variant="caption" color="text.secondary">
                                            {formatDate(log.created_at)}
                                        </Typography>
                                    </Box>
                                    <Box
                                        component="pre"
                                        sx={{
                                            m: 0,
                                            p: 1.5,
                                            bgcolor: 'action.selected',
                                            borderRadius: 1,
                                            fontFamily: 'monospace',
                                            fontSize: '0.8125rem',
                                            overflowX: 'auto',
                                            color: 'text.primary'
                                        }}
                                    >
                                        {JSON.stringify(JSON.parse(log.payload || '{}'), null, 2)}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )
                )}
            </Paper>
        </Box>
    );
};

export default Logs;
