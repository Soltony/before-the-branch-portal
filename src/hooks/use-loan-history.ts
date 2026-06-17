
'use client';

import { useState } from 'react';
import type { LoanDetails } from '@/lib/types';

// This hook is now simplified to only handle the client-side state for the loan history.
// All modifications (adding loans, adding payments) are handled via API calls
// in the components themselves, which then update this state.

export function useLoanHistory(initialLoans: LoanDetails[] = []) {
  const [loans, setLoans] = useState<LoanDetails[]>(initialLoans);

  return { loans, setLoans };
}
