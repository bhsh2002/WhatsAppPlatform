import React from 'react';
import { Typography } from '@mui/material';

const visuallyHiddenStyles = {
    position: 'absolute',
    width: 1,
    height: 1,
    p: 0,
    m: -1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
};

const mergeSx = (base, sx) => [base, ...(Array.isArray(sx) ? sx : (sx ? [sx] : []))];

export const PageTitle = ({ children, variant = 'h4', visuallyHidden = false, sx, ...props }) => (
    <Typography
        component="h1"
        variant={variant}
        sx={visuallyHidden ? mergeSx(visuallyHiddenStyles, sx) : sx}
        {...props}
    >
        {children}
    </Typography>
);

export const SectionTitle = ({ children, variant = 'h6', ...props }) => (
    <Typography component="h2" variant={variant} {...props}>
        {children}
    </Typography>
);

export const MetricValue = ({ children, variant = 'h5', ...props }) => (
    <Typography component="p" variant={variant} {...props}>
        {children}
    </Typography>
);

export default PageTitle;
