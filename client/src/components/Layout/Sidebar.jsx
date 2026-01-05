import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
    Avatar,
    Divider,
    Button,
    Chip
} from '@mui/material';
import {
    Dashboard as DashboardIcon,
    People as PeopleIcon,
    Chat as ChatIcon,
    WhatsApp as WhatsAppIcon,
    Assessment as AssessmentIcon,
    Settings as SettingsIcon,
    Logout as LogoutIcon,
    Person as PersonIcon,
    Description as TemplateIcon,
    Api as ApiIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
    const { user, tenant, logout, isTenant, isAdmin } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    // Admin navigation items
    const adminNavItems = [
        { label: 'لوحة القيادة', path: '/', icon: <DashboardIcon /> },
        { label: 'إدارة العملاء', path: '/tenants', icon: <PeopleIcon /> },
        { label: 'المحادثات', path: '/chat', icon: <ChatIcon /> },
        { label: 'منصة واتساب', path: '/whatsapp', icon: <WhatsAppIcon /> },
        { label: 'سجلات التشغيل', path: '/logs', icon: <AssessmentIcon /> },
        { label: 'الإعدادات', path: '/settings', icon: <SettingsIcon /> },
    ];

    // Tenant navigation items
    const tenantNavItems = [
        { label: 'لوحة القيادة', path: '/portal', icon: <DashboardIcon /> },
        { label: 'المحادثات', path: '/portal/chat', icon: <ChatIcon /> },
        { label: 'القوالب', path: '/portal/templates', icon: <TemplateIcon /> },
        { label: 'إعدادات API', path: '/portal/api-settings', icon: <ApiIcon /> },
    ];

    const navItems = isTenant ? tenantNavItems : adminNavItems;

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            borderRight: '1px solid rgba(0,0,0,0.12)'
        }}>
            {/* Logo Area */}
            <Box sx={{
                p: 3,
                display: 'flex',
                alignItems: 'center',
                gap: 2
            }}>
                <Box sx={{
                    width: 40,
                    height: 40,
                    bgcolor: isTenant ? 'secondary.main' : 'primary.main',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '1.5rem',
                    boxShadow: 2
                }}>
                    {isTenant ? '🏢' : '⚡'}
                </Box>
                <Box>
                    <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                        {isTenant ? (tenant?.name || 'بوابة العميل') : 'مراقب واتساب'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {isTenant ? 'بوابة العميل' : 'لوحة الإدارة المركزية'}
                    </Typography>
                </Box>
            </Box>

            <Divider />

            {/* Navigation */}
            <List sx={{ flex: 1, px: 2, py: 2 }}>
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                        <ListItem key={item.path} disablePadding sx={{ mb: 1 }}>
                            <ListItemButton
                                onClick={() => navigate(item.path)}
                                selected={isActive}
                                sx={{
                                    borderRadius: 2,
                                    '&.Mui-selected': {
                                        bgcolor: isTenant ? 'secondary.light' : 'primary.light',
                                        color: isTenant ? 'secondary.contrastText' : 'primary.contrastText',
                                        '&:hover': { bgcolor: isTenant ? 'secondary.dark' : 'primary.dark' },
                                        '& .MuiListItemIcon-root': { color: 'inherit' }
                                    }
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 40, color: isActive ? 'inherit' : 'text.secondary' }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText
                                    primary={item.label}
                                    primaryTypographyProps={{ fontWeight: isActive ? 600 : 400 }}
                                />
                            </ListItemButton>
                        </ListItem>
                    );
                })}
            </List>

            <Divider />

            {/* User Profile */}
            <Box sx={{ p: 2 }}>
                {user && (
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        mb: 2,
                        p: 1.5,
                        bgcolor: 'action.hover',
                        borderRadius: 2
                    }}>
                        <Avatar sx={{ bgcolor: isTenant ? 'secondary.main' : 'primary.main', width: 36, height: 36 }}>
                            <PersonIcon />
                        </Avatar>
                        <Box sx={{ overflow: 'hidden', flex: 1 }}>
                            <Typography variant="subtitle2" noWrap>
                                {user.name || user.username}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Chip
                                    label={isTenant ? 'عميل' : (isAdmin ? 'مدير' : 'مستخدم')}
                                    size="small"
                                    color={isTenant ? 'secondary' : 'primary'}
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                            </Box>
                        </Box>
                    </Box>
                )}

                <Button
                    fullWidth
                    variant="outlined"
                    color="error"
                    startIcon={<LogoutIcon />}
                    onClick={handleLogout}
                >
                    تسجيل الخروج
                </Button>
            </Box>
        </Box>
    );
};

export default Sidebar;

