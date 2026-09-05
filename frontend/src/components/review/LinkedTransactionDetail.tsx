import { Chip, Stack, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { Transaction, transactionService } from '../../services/transactionService';
import { formatCurrency } from '../../utils/currency';

interface DetailRendererProps {
  data: Transaction;
}

export const LinkedTransactionDetail: React.FC<DetailRendererProps> = ({ data }) => {
  const [linked, setLinked] = useState<Transaction | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!data.duplicate_of_id) return;

    transactionService
      .getTransaction(data.duplicate_of_id)
      .then((res) => {
        if (active) setLinked(res.data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [data.duplicate_of_id]);

  if (failed) return <Typography variant="caption" color="error" sx={{ p: 1 }}>Failed to load linked transaction</Typography>;
  if (!linked) return <Typography variant="caption" color="text.secondary" sx={{ p: 1 }}>Loading linked transaction...</Typography>;

  return (
    <Stack direction="row" spacing={2} sx={{ p: 1, alignItems: 'center', flexWrap: 'nowrap' }}>
      <Chip color="secondary" label="Linked Curve transaction" size="small" variant="outlined" />
      <Typography variant="body2">{linked.date}</Typography>
      <Typography variant="body2">{formatCurrency(linked.amount)}</Typography>
      <Typography variant="body2" sx={{ flex: 1 }}>{linked.description}</Typography>
      <Typography variant="body2" color="text.secondary">{linked.merchant || ''}</Typography>
      <Chip color="primary" label={`Pred: ${linked.category_predicted || 'N/A'}`} size="small" variant="outlined" />
      <Chip color="success" label={`Final: ${linked.category_final || 'N/A'}`} size="small" variant="outlined" />
    </Stack>
  );
};
