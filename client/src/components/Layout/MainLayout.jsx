import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
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
                <AppBar position="fixed" elevation={1} sx={{
                    bgcolor: 'background.paper',
                    color: 'text.primary',
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
                        <Typography variant="subtitle1" fontWeight={600} sx={{ ml: 1 }}>
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
                    pt: { xs: '48px', md: 0 }
                }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default MainLayout;
