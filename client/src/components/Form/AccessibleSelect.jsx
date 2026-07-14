import React, { forwardRef } from 'react';
import { Select as MuiSelect } from '@mui/material';

const AccessibleSelect = forwardRef(function AccessibleSelect({
  label,
  labelId,
  inputProps,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}, ref) {
  const explicitLabel = inputProps?.['aria-label'] || ariaLabel;
  const explicitLabelledBy = inputProps?.['aria-labelledby'] || ariaLabelledBy;
  const inferredLabel = typeof label === 'string' || typeof label === 'number'
    ? String(label)
    : undefined;
  const resolvedInputProps = explicitLabel || explicitLabelledBy || (!labelId && inferredLabel)
    ? {
        ...inputProps,
        ...(explicitLabel ? { 'aria-label': explicitLabel } : {}),
        ...(explicitLabelledBy ? { 'aria-labelledby': explicitLabelledBy } : {}),
        ...(!explicitLabel && !explicitLabelledBy && !labelId && inferredLabel
          ? { 'aria-label': inferredLabel }
          : {})
      }
    : inputProps;

  return (
    <MuiSelect
      ref={ref}
      label={label}
      labelId={labelId}
      inputProps={resolvedInputProps}
      {...props}
    />
  );
});

export default AccessibleSelect;
