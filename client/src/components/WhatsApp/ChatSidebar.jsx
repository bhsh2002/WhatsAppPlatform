import React, { useState } from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Typography,
    TextField,
    InputAdornment,
    Badge,
    CircularProgress,
    IconButton,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button
} from '@mui/material';
import {
    Search as SearchIcon,
    ChatBubble as NewChatIcon,
    Close as CloseIcon,
    Contacts as ContactsIcon
} from '@mui/icons-material';

const ChatSidebar = ({
    conversations,
    selectedChat,
    onSelectChat,
    onNewChat,
    loading,
    searchTerm,
    setSearchTerm,
    getDisplayName,
    formatDate,
    // Contacts props
    contacts = [],
    onLoadContacts,
    onAddContact,
    onEditContact,
    onDeleteContact
}) => {
    const [showNewChatDialog, setShowNewChatDialog] = useState(false);
    const [showContactsDialog, setShowContactsDialog] = useState(false);
    const [newChatPhone, setNewChatPhone] = useState('');
    const [contactForm, setContactForm] = useState({ phone: '', profile_name: '', label: '', notes: '' });
    const [editingContact, setEditingContact] = useState(null);
    const [contactsLoading, setContactsLoading] = useState(false);

    const handleStartNewChat = () => {
        const phone = newChatPhone.replace(/[\s\-\+]/g, '').trim();
        if (!phone || phone.length < 9) {
            alert('يرجى إدخال رقم هاتف صالح');
            return;
        }

        // Create a virtual conversation object
        const newConv = {
            contact: phone,
            profile_name: null,
            last_message: null,
            last_interaction: new Date().toISOString(),
            unread_count: 0
        };

        if (onNewChat) {
            onNewChat(newConv);
        } else {
            onSelectChat(newConv);
        }

        setShowNewChatDialog(false);
        setNewChatPhone('');
    };

    const handleOpenContacts = async () => {
        setShowContactsDialog(true);
        if (onLoadContacts) {
            setContactsLoading(true);
            try {
                await onLoadContacts();
            } finally {
                setContactsLoading(false);
            }
        }
    };

    const handleSaveContact = async () => {
        const phone = contactForm.phone.replace(/[\s\-\+]/g, '').trim();
        if (!phone || phone.length < 9) {
            alert('يرجى إدخال رقم هاتف صالح');
            return;
        }

        try {
            if (editingContact) {
                await onEditContact(editingContact.id, contactForm);
            } else {
                await onAddContact(contactForm);
            }
            setContactForm({ phone: '', profile_name: '', label: '', notes: '' });
            setEditingContact(null);
            if (onLoadContacts) {
                await onLoadContacts();
            }
        } catch (err) {
            alert(err.message || 'حدث خطأ');
        }
    };

    const handleDeleteContact = async (contactId) => {
        if (!window.confirm('هل تريد حذف جهة الاتصال؟')) return;
        try {
            await onDeleteContact(contactId);
            if (onLoadContacts) {
                await onLoadContacts();
            }
        } catch (err) {
            alert(err.message || 'حدث خطأ');
        }
    };

    const handleEditContact = (contact) => {
        setEditingContact(contact);
        setContactForm({
            phone: contact.phone || '',
            profile_name: contact.profile_name || '',
            label: contact.label || '',
            notes: contact.notes || ''
        });
    };

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid rgba(0,0,0,0.1)',
            bgcolor: 'background.paper'
        }}>
            {/* Search Header */}
            <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6" fontWeight={700}>
                        المحادثات
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {onLoadContacts && (
                            <Tooltip title="جهات الاتصال">
                                <IconButton
                                    onClick={handleOpenContacts}
                                    size="small"
                                    sx={{
                                        bgcolor: 'grey.100',
                                        '&:hover': { bgcolor: 'grey.200' },
                                        width: 36,
                                        height: 36
                                    }}
                                >
                                    <ContactsIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title="محادثة جديدة">
                            <IconButton
                                onClick={() => setShowNewChatDialog(true)}
                                size="small"
                                sx={{
                                    bgcolor: 'primary.main',
                                    color: 'white',
                                    '&:hover': { bgcolor: 'primary.dark' },
                                    width: 36,
                                    height: 36
                                }}
                            >
                                <NewChatIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="بحث..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>

            {/* Conversations */}
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress size={32} />
                    </Box>
                ) : conversations.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                        <Typography gutterBottom>لا توجد محادثات</Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<NewChatIcon />}
                            onClick={() => setShowNewChatDialog(true)}
                        >
                            بدء محادثة جديدة
                        </Button>
                    </Box>
                ) : (
                    <List disablePadding>
                        {conversations.map((conv, idx) => {
                            const isSelected = selectedChat?.contact === conv.contact &&
                                (selectedChat?.tenant_id === conv.tenant_id || (!selectedChat?.tenant_id && !conv.tenant_id));

                            return (
                                <ListItem
                                    key={conv.contact + '_' + (conv.tenant_id || idx)}
                                    component="div"
                                    onClick={() => onSelectChat(conv)}
                                    sx={{
                                        cursor: 'pointer',
                                        borderBottom: '1px solid rgba(0,0,0,0.05)',
                                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                                        '&:hover': { bgcolor: 'action.hover' },
                                        py: 1.5,
                                        px: 2
                                    }}
                                >
                                    <ListItemAvatar>
                                        <Badge
                                            badgeContent={conv.unread_count}
                                            color="success"
                                            overlap="circular"
                                        >
                                            <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>
                                                {conv.profile_picture_url ? (
                                                    <img src={conv.profile_picture_url} alt="" style={{ width: '100%', height: '100%' }} />
                                                ) : (
                                                    (getDisplayName(conv) || '?')[0].toUpperCase()
                                                )}
                                            </Avatar>
                                        </Badge>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                                                <Typography variant="subtitle1" sx={{
                                                    fontWeight: conv.unread_count ? 700 : 400,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '0.95rem'
                                                }}>
                                                    {getDisplayName(conv)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', ml: 1 }}>
                                                    {formatDate(conv.last_interaction)}
                                                </Typography>
                                            </Box>
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: '75%' }}>
                                                    {conv.last_message?.substring(0, 40) || 'صورة/ملف'}
                                                </Typography>
                                                {conv.tenant_name && (
                                                    <Box component="span" sx={{
                                                        bgcolor: 'primary.light',
                                                        color: 'primary.contrastText',
                                                        px: 0.5,
                                                        borderRadius: 0.5,
                                                        fontSize: '0.65rem',
                                                        opacity: 0.8
                                                    }}>
                                                        {conv.tenant_name}
                                                    </Box>
                                                )}
                                            </Box>
                                        }
                                    />
                                </ListItem>
                            );
                        })}
                    </List>
                )}
            </Box>

            {/* New Chat Dialog */}
            <Dialog
                open={showNewChatDialog}
                onClose={() => setShowNewChatDialog(false)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    محادثة جديدة
                    <IconButton onClick={() => setShowNewChatDialog(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        أدخل رقم الهاتف مع رمز الدولة (مثال: 966501234567)
                    </Typography>
                    <TextField
                        autoFocus
                        fullWidth
                        label="رقم الهاتف"
                        placeholder="966501234567"
                        value={newChatPhone}
                        onChange={(e) => setNewChatPhone(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleStartNewChat();
                        }}
                        dir="ltr"
                        sx={{
                            '& input': { textAlign: 'left', direction: 'ltr' }
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowNewChatDialog(false)}>إلغاء</Button>
                    <Button
                        variant="contained"
                        onClick={handleStartNewChat}
                        disabled={!newChatPhone.trim()}
                    >
                        بدء المحادثة
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Contacts Dialog */}
            <Dialog
                open={showContactsDialog}
                onClose={() => {
                    setShowContactsDialog(false);
                    setEditingContact(null);
                    setContactForm({ phone: '', profile_name: '', label: '', notes: '' });
                }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    جهات الاتصال
                    <IconButton onClick={() => setShowContactsDialog(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    {contactsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <Box>
                            {/* Add/Edit Contact Form */}
                            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                                <Typography variant="subtitle2" gutterBottom>
                                    {editingContact ? 'تعديل جهة اتصال' : 'إضافة جهة اتصال جديدة'}
                                </Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                    <TextField
                                        size="small"
                                        label="رقم الهاتف"
                                        placeholder="966501234567"
                                        value={contactForm.phone}
                                        onChange={(e) => setContactForm(f => ({ ...f, phone: e.target.value }))}
                                        disabled={!!editingContact}
                                        fullWidth
                                    />
                                    <TextField
                                        size="small"
                                        label="الاسم"
                                        value={contactForm.profile_name}
                                        onChange={(e) => setContactForm(f => ({ ...f, profile_name: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        size="small"
                                        label="التصنيف"
                                        value={contactForm.label}
                                        onChange={(e) => setContactForm(f => ({ ...f, label: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        size="small"
                                        label="ملاحظات"
                                        value={contactForm.notes}
                                        onChange={(e) => setContactForm(f => ({ ...f, notes: e.target.value }))}
                                        fullWidth
                                        multiline
                                        rows={2}
                                    />
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <Button
                                            variant="contained"
                                            size="small"
                                            onClick={handleSaveContact}
                                            disabled={!contactForm.phone || !contactForm.phone.trim()}
                                        >
                                            {editingContact ? 'حفظ' : 'إضافة'}
                                        </Button>
                                        {editingContact && (
                                            <Button
                                                size="small"
                                                onClick={() => {
                                                    setEditingContact(null);
                                                    setContactForm({ phone: '', profile_name: '', label: '', notes: '' });
                                                }}
                                            >
                                                إلغاء
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            </Box>

                            {/* Contacts List */}
                            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                                {contacts.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                                        لا توجد جهات اتصال
                                    </Typography>
                                ) : (
                                    contacts.map(contact => (
                                        <Box
                                            key={contact.id}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                p: 1.5,
                                                borderBottom: '1px solid',
                                                borderColor: 'divider',
                                                '&:hover': { bgcolor: 'action.hover' }
                                            }}
                                        >
                                            <Box sx={{ flex: 1 }}>
                                                <Typography variant="body2">
                                                    {contact.profile_name || contact.phone}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {contact.phone}
                                                    {contact.label && ` • ${contact.label}`}
                                                </Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                <Button size="small" onClick={() => handleEditContact(contact)}>
                                                    تعديل
                                                </Button>
                                                <Button
                                                    size="small"
                                                    color="error"
                                                    onClick={() => handleDeleteContact(contact.id)}
                                                >
                                                    حذف
                                                </Button>
                                            </Box>
                                        </Box>
                                    ))
                                )}
                            </Box>
                        </Box>
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default ChatSidebar;
