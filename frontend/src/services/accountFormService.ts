import { Account, transactionService } from './transactionService';

interface ExistingCard {
  id: string;
  card_number: string;
}

export interface AccountNumberValidation {
  valid: boolean;
  error: string;
}

const onlyDigits = (value: string): string => value.replace(/\D/g, '');

export const accountFormService = {
  validateAccountNumber(value: string): AccountNumberValidation {
    const trimmed = value.trim();
    if (trimmed.length < 4) {
      return {
        valid: false,
        error: 'Account number must be at least 4 characters',
      };
    }
    if (!/^[A-Za-z0-9*\-.]{4,}$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Account number can only contain letters, numbers, *, -, and periods',
      };
    }
    return { valid: true, error: '' };
  },

  isAccountFormValid(name: string, accountNumber: string): boolean {
    if (!name.trim()) return false;
    return this.validateAccountNumber(accountNumber).valid;
  },

  findMatchingAccount(accounts: Account[], detectedNumber: string): Account | undefined {
    if (!detectedNumber) return undefined;
    const detectedDigits = onlyDigits(detectedNumber);
    const suffixMatches = (registered: string) =>
      detectedDigits.length >= 4 && onlyDigits(registered).endsWith(detectedDigits);

    return accounts.find((acc) => {
      if (acc.account_number.trim() === detectedNumber) return true;
      if (suffixMatches(acc.account_number)) return true;
      return acc.cards.some((c) => suffixMatches(c.card_number));
    });
  },

  async syncCards(accountId: string, existingCards: ExistingCard[], desiredNumbers: string[]): Promise<void> {
    const existingNumbers = new Set(existingCards.map((c) => c.card_number));
    const desiredSet = new Set(desiredNumbers.map((n) => n.trim()).filter(Boolean));

    const toAdd = [...desiredSet].filter((n) => !existingNumbers.has(n));
    const toRemove = existingCards.filter((c) => !desiredSet.has(c.card_number));

    await Promise.all([
      ...toAdd.map((n) => transactionService.addCard(accountId, n)),
      ...toRemove.map((c) => transactionService.removeCard(accountId, c.id)),
    ]);
  },
};