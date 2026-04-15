import React, { useState } from 'react';
import { Box, AppBar, Toolbar, IconButton, Typography, Drawer, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Sidebar from './Sidebar';
import { useLocation } from 'react-router-dom';

const drawerWidth = 280;

const chatPaths = ['/chat', '/portal/chat'];

const MainLayout = ({ children }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();

    const isChatPage = chatPaths.some(path => location.pathname === path);

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
            {isMobile && !isChatPage && (
                <AppBar position="fixed" elevation={1} sx={{
                    bgcolor: 'background.paper',
                    color: 'text.primary',
                    zIndex: 1200,
                    display: { xs: 'flex', md: 'none' }
                }}>
                    <Toolbar sx={{ minHeight: '48px !important' }}>
                        <IconButton
                            color="primary"
                            edge="start"
                            onClick={handleDrawerToggle}
                            aria-label="open drawer"
                        >
                            <MenuIcon />
                        </IconButton>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ ml: 1 }}>
                            واتساب
                        </Typography>
                    </Toolbar>
                </AppBar>
            )}

            <Box
                component="nav"
                sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
            >
                <Drawer
                    variant="temporary"
                    anchor={theme.direction === 'rtl' ? 'left' : 'right'}
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

                <Drawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', md: 'block' },
                        '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                    }}
                    open
                >
                    <Sidebar />
                </Drawer>
            </Box>

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    width: { md: `calc(100% - ${drawerWidth}px)` },
                    minHeight: '100vh',
                    position: 'relative',
                    overflowX: 'hidden',
                    ...(isMobile && !isChatPage ? { pt: '48px' } : {})
                }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default MainLayout;