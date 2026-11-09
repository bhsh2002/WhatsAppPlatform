import React, { useId } from 'react';
import { Box, Chip, FormControl, InputLabel, MenuItem, Typography } from '@mui/material';
import Select from '../../components/Form/AccessibleSelect';
import {
    activeCentralPlanPrices, centralAnnualPlanSavings, formatCentralOfferPrice, formatCentralQuoteAmount,
} from './centralOfferPresentation';

export const CentralAnnualSaving = ({ plan, price, locale, includeNote = false }) => {
    const saving = centralAnnualPlanSavings(plan, price);
    if (!saving) return null;
    return (
        <Box sx={{ display: 'grid', gap: 0.5, mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
                تكلفة 12 شهرًا بالسعر الشهري:{' '}
                <Box component="del">{formatCentralQuoteAmount(saving.original_amount_minor, saving.currency, locale)}</Box>
            </Typography>
            <Chip size="small" variant="outlined" color="success" sx={{ justifySelf: 'start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} label={`توفير ${formatCentralQuoteAmount(saving.savings_minor, saving.currency, locale)} سنويًا${saving.percent ? ` · ${saving.percent.toLocaleString(locale)}٪` : ''}`} />
            {includeNote && <Typography variant="caption" color="text.secondary">السعر السنوي يتضمن هذا التوفير بالفعل.</Typography>}
        </Box>
    );
};

const CentralPlanPricing = ({ plan, price, locale, disabled, onPriceChange }) => {
    const labelId = useId();
    const prices = activeCentralPlanPrices(plan);
    return (
        <Box sx={{ my: 1.5 }}>
            {prices.length > 1 && (
                <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                    <InputLabel id={labelId}>دورة الاشتراك</InputLabel>
                    <Select labelId={labelId} label="دورة الاشتراك" value={price?.id || ''} disabled={disabled} onChange={event => onPriceChange(event.target.value)}>
                        {!price && <MenuItem value="" disabled>اختر دورة الاشتراك</MenuItem>}
                        {prices.map(item => <MenuItem key={item.id} value={item.id}>{item.billing_period === 'yearly' ? 'سنوي' : 'شهري'} · {formatCentralQuoteAmount(item.amount_minor, item.currency, locale)}</MenuItem>)}
                    </Select>
                </FormControl>
            )}
            <Typography fontWeight={800} sx={{ mb: price?.billing_period === 'yearly' ? 0.5 : 0 }}>
                {formatCentralOfferPrice(price, locale) || 'السعر غير متاح'}
            </Typography>
            {price?.billing_period === 'yearly' && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>يُدفع مرة واحدة سنويًا</Typography>}
            <CentralAnnualSaving plan={plan} price={price} locale={locale} />
        </Box>
    );
};

export default CentralPlanPricing;
