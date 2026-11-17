import React, { useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Inventory2, Search } from '@mui/icons-material';
import { useLanguage } from '../../context/LanguageContext';

import { integratedProductCanPrepareMessage, integratedProductMessage, integratedProductPreparationReason, integratedProductPricing } from './integratedProductPresentation';

const IntegratedProductPicker = ({ open, onClose, products = [], onSelect }) => {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [blockedProduct, setBlockedProduct] = useState(null);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter(product => [
      product.name,
      product.sku,
      product.barcode,
      product.shelf_code,
    ].some(value => String(value || '').toLowerCase().includes(query)));
  }, [products, search]);

  const handleSelect = product => {
    const message = integratedProductMessage(product, t);
    if (message === null) {
      setBlockedProduct(product);
      return;
    }
    setBlockedProduct(null);
    onSelect(message, product);
    setSearch('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { 'aria-label': t('inbox.integratedProductDialogLabel') } }}
    >
      <DialogTitle>{t('inbox.integratedProductDialogTitle')}</DialogTitle>
      <DialogContent>
        {blockedProduct && <Alert severity="warning" sx={{ mt: 1 }}>{integratedProductPreparationReason(blockedProduct, t)}</Alert>}
        <TextField
          fullWidth
          size="small"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={t('inbox.integratedProductSearch')}
          inputProps={{ 'aria-label': t('inbox.integratedProductSearch') }}
          sx={{ mt: 1, mb: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>
            ),
          }}
        />
        {filtered.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Inventory2 sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography color="text.secondary">
              {t('inbox.integratedProductEmpty')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {filtered.map((product, index) => {
              const key = product.canonical_product_id
                || product.local_product_id
                || product.sku
                || `${product.barcode}-${index}`;
              const quantity = product.quantity_available ?? product.quantity_on_hand;
              const pricing = integratedProductPricing(product);
              return (
                <ListItem key={key} disablePadding>
                  <ListItemButton onClick={() => handleSelect(product)} divider>
                    <Avatar src={product.image_url || undefined} variant="rounded" sx={{ mr: 1.5 }}>
                      <Inventory2 />
                    </Avatar>
                    <ListItemText
                      primary={product.name || product.sku || product.barcode}
                      secondary={[product.sku, product.barcode].filter(Boolean).join(' • ')}
                    />
                    <Stack spacing={0.5} alignItems="flex-end">
                      {pricing.ready ? (
                        <Chip size="small" color="primary" variant="outlined" label={`${pricing.price} ${pricing.currency}`} />
                      ) : (
                        <Typography variant="caption" color="warning.dark">{integratedProductPreparationReason(product, t)}</Typography>
                      )}
                      {pricing.ready && !integratedProductCanPrepareMessage(product) && (
                        <Typography variant="caption" color="warning.dark">{integratedProductPreparationReason(product, t)}</Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {quantity !== null && quantity !== undefined
                          ? t('inbox.integratedProductStock', { quantity })
                          : t('inbox.integratedProductStockUnavailable')}
                        {product.shelf_code
                          ? ` • ${t('inbox.integratedProductShelfShort', { shelf: product.shelf_code })}`
                          : ''}
                      </Typography>
                    </Stack>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t('common.close')}</Button></DialogActions>
    </Dialog>
  );
};

export default IntegratedProductPicker;
