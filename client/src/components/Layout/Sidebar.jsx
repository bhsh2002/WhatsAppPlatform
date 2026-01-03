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
    Button
} from '@mui/material';
import {
    Dashboard as DashboardIcon,
    People as PeopleIcon,
    Chat as ChatIcon,
    WhatsApp as WhatsAppIcon,
    Assessment as AssessmentIcon,
    Settings as SettingsIcon,
    Logout as LogoutIcon,
    Person as PersonIcon
} from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const navItems = [
        { label: 'لوحة القيادة', path: '/', icon: <DashboardIcon /> },
        { label: 'إدارة العملاء', path: '/tenants', icon: <PeopleIcon /> },
        { label: 'المحادثات', path: '/chat', icon: <ChatIcon /> },
        { label: 'منصة واتساب', path: '/whatsapp', icon: <WhatsAppIcon /> },
        { label: 'سجلات التشغيل', path: '/logs', icon: <AssessmentIcon /> },
        { label: 'الإعدادات', path: '/settings', icon: <SettingsIcon /> },
    ];

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
                    bgcolor: 'primary.main',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '1.5rem',
                    boxShadow: 2
                }}>
                    ⚡
                </Box>
                <Box>
                    <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                        مراقب واتساب
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        لوحة الإدارة المركزية
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
                                        bgcolor: 'primary.light',
                                        color: 'primary.contrastText',
                                        '&:hover': { bgcolor: 'primary.dark' },
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
                        <Avatar sx={{ bgcolor: 'secondary.main', width: 36, height: 36 }}>
                            <PersonIcon />
                        </Avatar>
                        <Box sx={{ overflow: 'hidden' }}>
                            <Typography variant="subtitle2" noWrap>
                                {user.name || user.username}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                                {user.role === 'admin' ? 'مدير' : 'مستخدم'}
                            </Typography>
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
