import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

const WhatsAppNumberContext = createContext({
  numbers: [],
  selectedPhoneNumberId: null,
  selectedNumber: null,
  loading: false,
  error: null,
  selectNumber: () => undefined,
  refreshNumbers: async () => undefined
});

// eslint-disable-next-line react-refresh/only-export-components
export const useWhatsAppNumbers = () => useContext(WhatsAppNumberContext);

export const WhatsAppNumberProvider = ({ children }) => {
  const { isTenant, isAuthenticated, user } = useAuth();
  const [numbers, setNumbers] = useState([]);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const selectNumber = useCallback(phoneNumberId => {
    const normalized = phoneNumberId ? String(phoneNumberId) : null;
    api.setWhatsAppPhoneNumberId(normalized);
    setSelectedPhoneNumberId(normalized);
  }, []);

  const refreshNumbers = useCallback(async () => {
    if (!isAuthenticated || !isTenant) {
      setNumbers([]);
      selectNumber(null);
      return [];
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPortalWhatsAppNumbers();
      const nextNumbers = Array.isArray(data?.numbers) ? data.numbers : [];
      setNumbers(nextNumbers);
      const stored = sessionStorage.getItem('whatsapp_phone_number_id');
      const selectedStillExists = nextNumbers.some(number => (
        String(number.phone_number_id) === String(stored || '') && number.is_active !== 0
      ));
      const nextSelected = selectedStillExists
        ? stored
        : data?.default_phone_number_id
          || nextNumbers.find(number => number.is_default)?.phone_number_id
          || nextNumbers[0]?.phone_number_id
          || null;
      selectNumber(nextSelected);
      return nextNumbers;
    } catch (requestError) {
      setError(requestError.message || 'فشل جلب أرقام WhatsApp');
      setNumbers([]);
      selectNumber(null);
      return [];
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isTenant, selectNumber]);

  useEffect(() => {
    refreshNumbers();
  }, [refreshNumbers, user?.tenant_id]);

  const selectedNumber = useMemo(() => numbers.find(number => (
    String(number.phone_number_id) === String(selectedPhoneNumberId)
  )) || null, [numbers, selectedPhoneNumberId]);

  const value = useMemo(() => ({
    numbers,
    selectedPhoneNumberId,
    selectedNumber,
    loading,
    error,
    selectNumber,
    refreshNumbers
  }), [numbers, selectedPhoneNumberId, selectedNumber, loading, error, selectNumber, refreshNumbers]);

  return <WhatsAppNumberContext.Provider value={value}>{children}</WhatsAppNumberContext.Provider>;
};
