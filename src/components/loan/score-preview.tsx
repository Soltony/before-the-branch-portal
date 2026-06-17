
'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ScoringParameter } from '@/lib/types';
import { evaluateCondition } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface FieldInfo {
    value: string;
    label: string;
    type?: 'select' | 'text' | 'number';
    options?: string[];
}


interface ScorePreviewProps {
  parameters: ScoringParameter[];
  availableFields: FieldInfo[];
  providerColor?: string;
}

export function ScorePreview({ parameters, availableFields, providerColor = '#fdb913' }: ScorePreviewProps) {
  const [applicantData, setApplicantData] = useState<Record<string, string>>({});
  const [calculatedScore, setCalculatedScore] = useState<number | null>(null);

  const uniqueFieldsInUse = useMemo(() => {
    const fieldsInUse = new Set<string>();
    parameters.forEach(param => {
        fieldsInUse.add(param.name);
    });

    return availableFields.filter(field => fieldsInUse.has(field.value));
  }, [parameters, availableFields]);

  const handleInputChange = (field: string, value: string) => {
    setApplicantData(prev => ({ ...prev, [field]: value }));
    setCalculatedScore(null); // Reset score when data changes
  };

  const handleCalculateScore = () => {
    let totalScore = 0;
    
    parameters.forEach(param => {
        let maxScoreForParam = 0;
        const relevantRules = param.rules || [];
        
        relevantRules.forEach(rule => {
            const inputValue = applicantData[rule.field];
            if (inputValue !== undefined) {
                 if (evaluateCondition(inputValue, rule.condition, rule.value)) {
                    if (rule.score > maxScoreForParam) {
                        maxScoreForParam = rule.score;
                    }
                }
            }
        });

        const scoreForThisParam = Math.min(maxScoreForParam, param.weight);
        totalScore += scoreForThisParam;
    });

    setCalculatedScore(Math.round(totalScore));
  };
  
  const getFieldInfo = (fieldName: string): FieldInfo | undefined => {
      return availableFields.find(f => f.value === fieldName);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview Score Calculation</CardTitle>
        <CardDescription>
          Enter sample applicant data to see the calculated score based on the current rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {uniqueFieldsInUse.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {uniqueFieldsInUse.map(field => {
              const fieldInfo = getFieldInfo(field.value);
              const inputType = field.value.toLowerCase().includes('date') ? 'date' :
                                field.value.toLowerCase().includes('gender') || field.value.toLowerCase().includes('education') ? 'text' : 'number';

              return (
                  <div key={field.value} className="space-y-2">
                    <Label htmlFor={`preview-${field.value}`} className="capitalize">{field.label}</Label>
                    {fieldInfo?.type === 'select' ? (
                      <Select onValueChange={(value) => handleInputChange(field.value, value)} value={applicantData[field.value] || ''}>
                        <SelectTrigger id={`preview-${field.value}`}>
                          <SelectValue placeholder={`Select ${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {fieldInfo.options?.filter(Boolean).map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`preview-${field.value}`}
                        type={inputType}
                        value={applicantData[field.value] || ''}
                        onChange={(e) => handleInputChange(field.value, e.target.value)}
                        placeholder={`Enter ${field.label}`}
                        className="focus-visible:ring-[--ring-color]"
                        style={{'--ring-color': providerColor} as React.CSSProperties}
                      />
                    )}
                  </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No parameters defined for this provider yet.</p>
        )}
        <div className="flex items-center justify-between">
            <Button onClick={handleCalculateScore} style={{ backgroundColor: providerColor }} className="text-white" disabled={uniqueFieldsInUse.length === 0}>Calculate Score</Button>
            {calculatedScore !== null && (
                <div className="text-right">
                    <p className="text-sm text-muted-foreground">Calculated Score</p>
                    <p className="text-3xl font-bold">{calculatedScore.toFixed(0)}</p>
                </div>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
