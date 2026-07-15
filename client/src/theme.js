import { createTheme } from '@mui/material/styles';

export const createAppTheme = (direction = 'rtl') => createTheme({
    direction,
    palette: {
        mode: 'light',
        primary: {
            main: '#087f5b',
            light: '#25D366',
            dark: '#0f4f40',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#087f4f',
            light: '#d7f7e3',
            dark: '#065f3c',
            contrastText: '#ffffff',
        },
        warning: {
            main: '#a15c00',
            dark: '#783f00',
            contrastText: '#ffffff',
        },
        error: {
            main: '#b42318',
            dark: '#7a271a',
            contrastText: '#ffffff',
        },
        success: {
            main: '#1f6b2c',
            dark: '#14532d',
            contrastText: '#ffffff',
        },
        background: {
            default: '#f7f2e8',
            paper: '#fffdf8',
        },
        text: {
            primary: '#16352f',
            secondary: '#5d6d68',
        },
        action: {
            hover: 'rgba(0, 0, 0, 0.04)',
            selected: 'rgba(0, 0, 0, 0.08)',
        },
    },
    typography: {
        fontFamily: [
            '"Alexandria Variable"',
            '"Segoe UI"',
            'Tahoma',
            'Arial',
            'sans-serif',
        ].join(','),
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: '#f7f2e8',
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    border: '1px solid #d7ccba',
                    borderRadius: '18px 5px 18px 18px',
                    boxShadow: '0 10px 30px rgba(22, 53, 47, 0.06)',
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    maxWidth: '100%',
                    whiteSpace: 'nowrap',
                    overflowWrap: 'normal',
                    wordBreak: 'normal',
                },
            },
        },
        MuiTableContainer: {
            styleOverrides: {
                root: {
                    width: '100%',
                    maxWidth: '100%',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                },
            },
        },
        MuiTable: {
            styleOverrides: {
                root: {
                    width: '100%',
                    tableLayout: 'auto',
                    '@media (max-width: 600px)': {
                        minWidth: 720,
                    },
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    verticalAlign: 'top',
                    whiteSpace: 'normal',
                    overflowWrap: 'break-word',
                    wordBreak: 'normal',
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    maxWidth: '100%',
                    height: 'auto',
                    minHeight: 28,
                },
                label: {
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    overflowWrap: 'normal',
                    wordBreak: 'normal',
                    paddingTop: 4,
                    paddingBottom: 4,
                },
            },
        },
        MuiAlert: {
            styleOverrides: {
                message: {
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    maxWidth: 'calc(100% - 32px)',
                    overflowWrap: 'anywhere',
                },
            },
        },
        MuiFormHelperText: {
            styleOverrides: {
                root: {
                    color: '#526069',
                    '&.Mui-disabled': {
                        color: '#526069',
                    },
                },
            },
        },
        MuiCircularProgress: {
            defaultProps: {
                'aria-label': 'Loading / جارٍ التحميل',
            },
        },
        MuiLinearProgress: {
            defaultProps: {
                'aria-label': 'Progress / مستوى التقدم',
            },
        },
    },
});

export default createAppTheme();
