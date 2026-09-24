import React, { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Inventory2, Search } from '@mui/icons-material';
import { useLanguage } from '../../context/LanguageContext';

const productMessage = (product, t) => {
  const parts = [product.name || product.sku || product.barcode || t('inbox.integratedProductFallback')];
  if (product.price !== null && product.price !== undefined && product.price !== '') {
    parts.push(t('inbox.integratedProductPrice', {
      price: product.price,
      currency: product.currency || 'LYD',
    }));
  }
  const quantity = product.quantity_available ?? product.quantity_on_hand;
  if (quantity !== null && quantity !== undefined && quantity !== '') {
    parts.push(t('inbox.integratedProductAvailable', { quantity }));
  }
  if (product.shelf_code) {
    parts.push(t('inbox.integratedProductShelf', { shelf: product.shelf_code }));
  }
  return parts.join(' — ');
};

const IntegratedProductPicker = ({ open, onClose, products = [], onSelect }) => {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
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
    onSelect(productMessage(product, t), product);
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
              return (
                <ListItemButton key={key} onClick={() => handleSelect(product)} divider>
                  <Avatar src={product.image_url || undefined} variant="rounded" sx={{ mr: 1.5 }}>
                    <Inventory2 />
                  </Avatar>
                  <ListItemText
                    primary={product.name || product.sku || product.barcode}
                    secondary={[product.sku, product.barcode].filter(Boolean).join(' • ')}
                  />
                  <Stack spacing={0.5} alignItems="flex-end">
                    {product.price !== null && product.price !== undefined && (
                      <Chip size="small" color="primary" variant="outlined" label={`${product.price} ${product.currency || 'LYD'}`} />
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
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default IntegratedProductPicker;
