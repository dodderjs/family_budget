import { Badge, Group, Text } from '@mantine/core';
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

  if (failed) return <Text size="xs" c="red" p="sm">Failed to load linked transaction</Text>;
  if (!linked) return <Text size="xs" c="dimmed" p="sm">Loading linked transaction...</Text>;

  return (
    <Group gap="md" wrap="nowrap" p="sm">
      <Badge color="grape" variant="light">Linked Curve transaction</Badge>
      <Text size="sm">{linked.date}</Text>
      <Text size="sm">{formatCurrency(linked.amount)}</Text>
      <Text size="sm" style={{ flex: 1 }}>{linked.description}</Text>
      <Text size="sm" c="dimmed">{linked.merchant || ''}</Text>
      <Badge color="blue" variant="light" size="sm">Pred: {linked.category_predicted || 'N/A'}</Badge>
      <Badge color="teal" variant="light" size="sm">Final: {linked.category_final || 'N/A'}</Badge>
    </Group>
  );
};
