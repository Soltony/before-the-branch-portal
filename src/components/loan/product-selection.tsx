'use client';

import type { LoanProvider, LoanProduct } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

interface ProductSelectionProps {
  provider: LoanProvider;
  onSelect: (product: LoanProduct) => void;
}

export function ProductSelection({ provider, onSelect }: ProductSelectionProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-4 mb-2">
          <provider.icon className="h-10 w-10 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{provider.name}</h1>
        </div>
        <p className="text-lg text-muted-foreground">Select one of our loan products to get started.</p>
      </div>
      <div className="space-y-4">
        {provider.products.map((product) => (
          <Card
            key={product.id}
            onClick={() => onSelect(product)}
            className="cursor-pointer hover:shadow-lg hover:border-primary transition-all duration-300"
          >
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="bg-secondary p-3 rounded-full">
                  <product.icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>{product.name}</CardTitle>
                  <CardDescription>{product.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
