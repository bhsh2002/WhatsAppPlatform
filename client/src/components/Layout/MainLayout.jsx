import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import Sidebar from './Sidebar';
import { useLanguage } from '../../context/LanguageContext';

const drawerWidth = 280;

const MainLayout = ({ children }) => {
    const theme = useTheme();
    const { direction, t } = useLanguage();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    return (
        <Box
            dir={direction}
            style={{ direction }}
            sx={{
                display: 'flex',
                flexDirection: 'row',
                minHeight: '100vh',
                bgcolor: 'background.default',
            }}
        >
            {isMobile && (
                <AppBar position="fixed" elevation={0} sx={{
                    bgcolor: 'rgba(247,242,232,0.96)',
                    color: 'text.primary',
                    borderBottom: '1px solid #d7ccba',
                    backdropFilter: 'blur(12px)',
                    zIndex: 1200
                }}>
                    <Toolbar sx={{ height: 48, minHeight: 48, py: 0 }}>
                        <IconButton
                            color="primary"
                            edge="start"
                            onClick={handleDrawerToggle}
                            aria-label={t('layout.openDrawer')}
                        >
                            <MenuIcon />
                        </IconButton>
                        <Box sx={{ width: 28, height: 28, bgcolor: 'primary.main', color: 'white', borderRadius: '10px 10px 3px 10px', display: 'grid', placeItems: 'center', ml: 1 }}>
                            <WhatsAppIcon sx={{ fontSize: 17 }} />
                        </Box>
                        <Typography variant="subtitle1" component="div" fontWeight={800} sx={{ ml: 1 }}>
                            Wa Savana
                        </Typography>
                    </Toolbar>
                </AppBar>
            )}

            <Drawer
                variant="temporary"
                anchor={direction === 'rtl' ? 'right' : 'left'}
                open={mobileOpen}
                onClose={handleDrawerToggle}
                ModalProps={{ keepMounted: true }}
                slotProps={{ paper: { 'aria-label': t('layout.mainNavigation') } }}
                sx={{
                    display: { xs: 'block', md: 'none' },
                    '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                }}
            >
                <Sidebar />
            </Drawer>

            <Box
                component="aside"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    display: { xs: 'none', md: 'block' },
                    height: '100vh',
                    position: 'sticky',
                    top: 0,
                    overflow: 'hidden',
                }}
            >
                <Sidebar />
            </Box>

            <Box
                component="main"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: '100vh',
                    position: 'relative',
                    overflowX: 'hidden',
                    pt: { xs: '48px', md: 0 },
                    background: 'linear-gradient(180deg, #f7f2e8 0%, #f3ecdf 100%)',
                }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default MainLayout;
