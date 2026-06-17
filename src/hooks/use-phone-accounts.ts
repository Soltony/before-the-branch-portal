import { useEffect, useState } from 'react';

type PhoneAccount = {
  id: string;
  phoneNumber: string;
  accountNumber: string;
  customerName?: string | null;
  isActive: boolean;
};

export default function usePhoneAccounts(phoneNumber?: string) {
  const [items, setItems] = useState<PhoneAccount[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!phoneNumber) return;
    fetchItems();
  }, [phoneNumber]);

  async function fetchItems() {
    setLoading(true);
    try {
      const res = await fetch(`/api/phone-accounts?phoneNumber=${encodeURIComponent(phoneNumber ?? '')}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } finally {
      setLoading(false);
    }
  }

  return { items, loading, refresh: fetchItems };
}
