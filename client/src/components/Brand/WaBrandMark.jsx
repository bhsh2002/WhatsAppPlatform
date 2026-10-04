import React from 'react';
import { Box } from '@mui/material';

const WaBrandMark = ({ size = 40, alt = 'Wa Savana', decorative = false }) => (
    <Box
        component="img"
        src="/brand/wa-savana-mark-v9.png"
        alt={decorative ? '' : alt}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        sx={{
            width: size,
            height: size,
            display: 'block',
            flexShrink: 0,
            objectFit: 'contain',
        }}
    />
);

export default WaBrandMark;
